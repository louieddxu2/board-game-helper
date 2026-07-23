# 玩錯的桌遊規則

> 這次玩對，或是下次玩對。

公開可閱讀、由指定編輯者維護的桌遊規則踩雷資料庫。前端是可安裝的 React PWA，API 使用 Cloudflare Worker，正式資料存於 D1。

## 本機開發

```powershell
npm install
npm run db:migrate:local
npm run import:legacy -- --apply
npm run dev
```

本機開發模式提供管理員登入，不需要 Google OAuth。Excel 原檔、匯入 SQL 與本機 D1 均已由 `.gitignore` 排除。

## 驗證

```powershell
npm test
npm run typecheck
npm run build
```

## 正式發布

正式環境使用獨立的 `wrangler.production.jsonc`，不會覆用本機 D1。

```powershell
npm run cloudflare:login
npx wrangler d1 create board-game-rules-prod --config wrangler.production.jsonc
```

把建立結果中的 `database_id` 填入 `wrangler.production.jsonc`，再執行：

```powershell
npm run db:migrate:remote
npm run import:legacy -- --apply --remote --confirm-remote
npm run deploy
```

首次部署取得 `workers.dev` 或自訂網域後，把 `APP_ORIGIN` 改成正式來源並重新部署。接著在 Google Cloud 建立 Web Client ID，將正式來源加入 Authorized JavaScript origins，最後把 Client ID 設為 Worker 的 `GOOGLE_CLIENT_ID` 變數。

Google 登入只驗證身分，不要求 Drive、Sheets、Gmail 或其他 Google API 權限。`BOOTSTRAP_ADMIN_EMAIL` 只負責首次建立管理員；其他編輯者由管理頁指派。

## 快取與公開 API

- 首頁最多回傳三組各 10 筆內容，瀏覽器與 Cloudflare CDN 分層快取。
- 遊戲搜尋有前端防抖、結果快取、筆數上限及 API 限速。
- 遊戲名稱透過 canonical game 與 aliases 檢索。
- 公開 API 可跨來源唯讀；寫入必須使用受信任來源與有效 Bearer session。
- `GET /api/export/public` 提供精簡公開快照，支援 CDN、ETag 與 304。
- IndexedDB 只保存可重建的閱讀快取，以及尚未送出的草稿／佇列。

## 計分板整合

整合文件：

- [計分板整合路線](docs/scorepad-integration.md)
- [OpenAPI v1](docs/openapi.yaml)
- [TypeScript client](integration/board-game-rules-client.ts)

計分板以遊戲名稱或別名呼叫 resolve API，取得此服務的 `gameId` 後再讀規則。兩個網站可各自使用同一個 Google 身分；規則服務驗證 Google ID token 後簽發自己的 Bearer session，不共用另一個網站的 cookie。

## 校稿交換

- 可依遊戲、標籤、流程、來源狀態及更新時間限定匯出範圍。
- 匯出 JSON 或 CSV 後可由人工或 AI 校稿。
- 匯入只建立提案，不會直接覆蓋正式資料。
- 每筆提案必須人工接受或拒絕；若原文已更新會標示衝突。

詳見 [校稿工作流](docs/review-workflow.md)。

## 備份

D1 Time Travel 用於短期災難復原；需要獨立檔案時可執行：

```powershell
npx wrangler d1 export board-game-rules-prod --remote --config wrangler.production.jsonc --output=imports/private/board-game-rules-backup.sql
```

`imports/private/` 不會提交到 Git。
