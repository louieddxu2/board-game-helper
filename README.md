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

登入及建立／編輯規則是發布不可破壞的核心流程。`npm run test:release` 會依序執行完整 Vitest、型別檢查、正式 build，接著建立隔離的本機 D1、從零套用全部 migration，並用獨立瀏覽器實際完成「登入 → Session Cookie → 建立新遊戲與規則 → 從 API 讀回 → 編輯規則 → 再次讀回 → 登出」。失敗時會在 `test-results/` 與 `playwright-report/` 保留 trace 與畫面；這套測試不會存取正式 D1。

```powershell
npm run test:core
npm run test:core:e2e
npm run test:release
```

Windows 會使用已安裝的 Google Chrome 建立乾淨、獨立的測試瀏覽器狀態；不會使用個人 Chrome profile。其他執行環境需先執行 `npx playwright install chromium`。正式發布完成後，流程還會執行 `npm run smoke:production`，確認健康 API、Session API、Google Client ID、本機登入開關及 Google Identity Services CSP。完整 Google 帳號選擇頁可能受驗證碼及第三方服務影響，因此自動測試以簽章 JWT 合約測試驗證 Google 身分規則，再由本機完整流程驗證相同的使用者、Session、Cookie 與 D1 寫入路徑。

GitHub 對 `master` 的 push 與所有 Pull Request 也會執行相同的 `test:release`；這是獨立於本機發布腳本的第二道阻擋，不能取代正式站發布後的 smoke test。

## 正式發布

正式環境使用獨立的 `wrangler.production.jsonc`，不會覆用本機 D1。

專案已固定 Cloudflare 登入流程：先檢查專案專屬 `.wrangler/xdg` 中既有的 Wrangler 登入狀態；只有在狀態失效時，才使用 `--no-use-keyring --browser=false` 產生一次性 OAuth 網址，並交給 Windows 預設瀏覽器開啟，等待同一個 Wrangler 程序的本機回呼完成。Windows 腳本會使用 PowerShell `Start-Process` 開瀏覽器，並以 shell-backed `npx.cmd` 執行狀態檢查，避免 `spawn EINVAL`。這是目前 Windows 環境驗證成功的流程；不要改回 `--use-keyring`、在其他 XDG 設定位置登入、重用舊網址或另外建立第二個登入程序。

在 Codex 或其他受限執行環境中，Cloudflare 登入與部署必須使用可連外的 elevated PTY；否則本機回呼雖可能成功，最後向 `https://dash.cloudflare.com/oauth2/token` 交換 token 時仍會因 `EACCES` 的 `fetch failed` 失敗。若自動啟動瀏覽器被阻擋，需用 Windows 預設瀏覽器開啟同一輪流程剛產生的網址，不能改用內嵌瀏覽器。

```powershell
npm run cloudflare:login
npx wrangler d1 create board-game-rules-prod --config wrangler.production.jsonc
npx wrangler secret put EMAIL_HASH_SECRET --config wrangler.production.jsonc
npx wrangler secret put ATTRIBUTE_QUESTION_SECRET --config wrangler.production.jsonc
```

把建立結果中的 `database_id` 填入 `wrangler.production.jsonc`，再執行：

```powershell
npm run db:migrate:remote
npm run import:legacy -- --apply --remote --confirm-remote
npm run deploy
```

`npm run deploy` 會先執行不可略過的 `test:release`；通過後才檢查 Cloudflare 登入、遠端 Migration 與必要 Secret，並比較上次成功發布後的 Git 差異。若修改碰到 Google 登入、帳號／Session、正式環境綁定、Client ID／來源、CSP 或相關 migration，終端會列出醒目提醒。若 Secret 遺失，部署會在更新 Worker 前中止並列出設定指令。Worker 更新後還必須通過正式站 smoke test，只有全部成功才會記錄本次成功發布。Secret 值只保存在 Cloudflare，不要寫入版本庫。若登入狀態失效，直接重新執行同一個 `npm run deploy` 即可；腳本會產生新網址、開啟預設瀏覽器，登入完成後繼續原流程。若使用 CI，請改用 `CLOUDFLARE_API_TOKEN`，不會嘗試開啟瀏覽器。

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
