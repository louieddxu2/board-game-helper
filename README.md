# 玩錯的桌遊規則

> 這次玩對，或是下次玩對。

公開閱讀、授權編輯的桌遊規則踩雷記錄平台。前端是可安裝的 React PWA，API 使用 Cloudflare Worker，正式資料放在 D1。

## 本機開發

```powershell
npm install
npm run db:migrate:local
npm run import:legacy -- --apply
npm run dev
```

在 localhost 可使用開發管理員登入。正式環境不提供此入口。

## 驗證

```powershell
npm test
npm run typecheck
npm run build
```

## 舊資料

原始 Excel 已由 `.gitignore` 排除。匯入器預設讀取工作區中的 `玩錯的桌遊規則紀錄.xlsx`，只將允許公開的欄位寫入 staging SQL；教學者與其他私人欄位不會輸出。能安全依換行拆分的資料會直接匯入，其餘留在 `/admin` 待確認。

產生 SQL 但不套用：

```powershell
npm run import:legacy
```

產生並套用到本機 D1：

```powershell
npm run import:legacy -- --apply
```

## 正式設定

1. 執行 `npx wrangler login`。
2. 建立正式資料庫：`npx wrangler d1 create board-game-rules-prod`。
3. 將回傳的 database ID 與正式資料庫名稱填進 `wrangler.jsonc`。
4. 在 Google Cloud Console 建立 Web Client ID，只需 Sign in with Google；不啟用 Drive、Sheets 或 Gmail scope。
5. 將正式網址與本機網址加入 Authorized JavaScript origins。
6. 將 `GOOGLE_CLIENT_ID`、`APP_ORIGIN` 與 `BOOTSTRAP_ADMIN_EMAIL` 設為 Worker 環境變數。
7. 執行 `npm run db:migrate:remote`，確認後再執行 `npm run import:legacy -- --remote --confirm-remote`。
8. 執行 `npm run deploy`。

`GOOGLE_CLIENT_ID` 是公開的 OAuth client 識別碼，不是 client secret；本專案不需要也不接受 Google Client Secret。登入成功後，Worker 會建立自己的 HttpOnly session cookie。

## 權限模型

- 未登入：公開閱讀、搜尋。
- `editor`：新增遊戲與規則、校稿、隱藏、復原、合併遊戲。
- `admin`：包含 editor 權限，另可用任意 Google 信箱預先授予或撤銷 editor/admin。
- `BOOTSTRAP_ADMIN_EMAIL` 只用來建立第一位管理員，目前為 `louieddxu2@gmail.com`。

## 尚未啟用

多人公開投稿、揪團、廣告、BGG 串接與完整離線雙向同步刻意不在 MVP 內。首頁與遊戲頁可快取；未送出的輸入保存在 IndexedDB。
