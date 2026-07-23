# 玩錯的桌遊規則

> 這次玩對，或是下次玩對。

公開可閱讀、由受邀編輯者維護的桌遊規則踩雷平台。前端是 React PWA，API 使用 Cloudflare Worker，正式資料存於 D1。

## 本機開發

```powershell
npm install
npm run db:migrate:local
npm run import:legacy -- --apply
npm run dev
```

本機預設網址是 `http://localhost:5173`。首頁、搜尋與遊戲頁公開；寫入需要本機管理員或正式 Google 登入。

## 驗證

```powershell
npm test
npm run typecheck
npm run build
```

## 舊資料

Excel 原始檔在 `.gitignore` 內，不會提交。匯入程式會保留原始列，先產生 staging SQL，再由管理介面確認拆分與遊戲名稱配對。

```powershell
npm run import:legacy
npm run import:legacy -- --apply
```

## 正式環境

1. `npx wrangler login`
2. 建立正式 D1：`npx wrangler d1 create board-game-rules-prod`
3. 將正式 database ID 寫入部署用 Wrangler 設定。
4. 在 Google Cloud Console 建立 Web Client ID，只使用 Sign in with Google，不要求 Drive、Sheets 或 Gmail scope。
5. 設定 Worker 變數：
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_IDS`（可選，多個 Client ID 時以逗號分隔）
   - `APP_ORIGIN`
   - `TRUSTED_APP_ORIGINS`（可選，允許整合的 App 網域）
   - `BOOTSTRAP_ADMIN_EMAIL`
6. `npm run db:migrate:remote`
7. `npm run deploy`

Google Client ID 可以公開；session secret 與其他敏感設定不得提交。

## 權限

- 訪客：讀取公開規則。
- `editor`：新增與編輯規則、整理遊戲名稱、處理匯入。
- `admin`：包含 editor 權限，並可邀請或撤銷其他編輯者。
- `BOOTSTRAP_ADMIN_EMAIL` 第一次登入後自動取得 admin。

角色由 Worker 與 D1 驗證，不依賴前端隱藏按鈕。

## 快取與呼叫量

- 首頁一次回傳精選、最近與熱門資料，每區最多十筆。
- 公開 GET 有 CDN Cache-Control，Wrangler Workers Caching 可在 Worker 執行前命中。
- 首頁與看過的遊戲頁也存入瀏覽器快取；草稿獨立存在 IndexedDB。
- 搜尋至少輸入兩字、350ms 防抖、限制結果數量，並快取最近查詢。
- 寫入、登入、管理 API 一律 `no-store`。
- 公開與寫入 API 有不同 Rate Limiting binding。

## 萬用桌遊計分板整合

平台提供可跨 App 使用的公開讀取 API，以及 Google ID token 交換短期 Bearer session 的寫入流程。計分板延續同一個 Google 帳號，但絕不把其 Drive access token 交給規則平台。

完整流程與範例：

- [計分板整合說明](docs/scorepad-integration.md)
- [OpenAPI v1](docs/openapi.yaml)
- [TypeScript client](integration/board-game-rules-client.ts)

公開讀取保持匿名以共用 CDN 快取；只有 session 檢查與寫入帶 Bearer token。遊戲名稱先由正式名稱與別名解析，計分板可保存 `localGameId → rulesGameId` 映射。

`GET /api/export/public` 可一鍵下載完整公開資料快照，支援 CDN、ETag/304 與瀏覽器壓縮。真正包含帳號、私人資料和歷史的 D1 管理備份，請使用：

```powershell
npx wrangler d1 export board-game-rules-prod --remote --output=board-game-rules-backup.sql
```

## 爬蟲與濫用

- `robots.txt` 阻止一般搜尋引擎索引 API 與管理頁，API 回應另有 `X-Robots-Tag`。
- Worker 限速與 Origin allowlist 保護動態 API。
- 公開內容無法對惡意爬蟲做到絕對禁止；大量讀取主要由 CDN 承擔，必要時再於 Cloudflare 啟用 Bot Fight Mode、WAF 或 Turnstile。
