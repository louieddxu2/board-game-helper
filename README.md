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

原始 Excel 已由 `.gitignore` 排除。匯入器預設讀取工作區中的 `玩錯的桌遊規則紀錄.xlsx`，只將允許公開的欄位寫入 staging SQL；教學者與其他私人欄位不會輸出。匯入規則經逐列稽核，會保留原始文字、多個來源網址與提交時間，並可安全重跑。

目前檔案的驗收基準為：105 次提交、135 條公開規則、66 個遊戲主檔、0 筆待確認；`氣笛山脈` 會併入 `Whistle Mountain 汽笛山脈` 並保留搜尋別名。匯入後應再執行 `PRAGMA foreign_key_check`，結果必須為空。

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

## 流程分類與標籤

- 流程位置描述規則發生在設置、回合、行動或計分等哪個時點，每條規則只有一個。
- 主題標籤可有多個，例如「時機／觸發」、「補牌」、「平手」。快速記錄時完全選填。
- 編輯者可套用既有標籤；管理員可建立新標籤。資料層另支援標籤別名與合併，避免同義詞長期分裂。

## 公開資料讀取

- 首頁一次最多回傳 10 條精選、10 條最新與 10 款熱門遊戲，不會下載整個 D1。
- 首頁快照存入 IndexedDB；五分鐘內再次開啟不發出首頁 API 請求，逾時後先顯示舊內容再背景更新。
- Service Worker 保存首頁與看過的遊戲頁；需要更新時採網路優先，離線才回傳舊內容，避免多層 stale-while-revalidate 讓舊資料被反覆延長。
- 遊戲搜尋停字 350ms 後才查詢，結果限制 20 款；首頁全文搜尋限制 8 款遊戲與 10 條規則。相同查詢會優先使用目前頁面生命週期內的記憶體快取。
- 遊戲名稱同時比對正式名稱與別名；建立遊戲時後端會再次做完全相同比對，避免略過介面時產生重複主檔。
- 首頁、搜尋、標籤與遊戲頁使用 Workers Caching；Cloudflare 會在執行 Worker 前檢查快取，命中時不消耗 Worker 請求，也不讀取 D1。
- 公開 API 每個來源每分鐘最多 120 次，寫入 API 每個來源每分鐘最多 30 次；超過時回傳 `429` 與 `Retry-After`。
- Rate Limiting 以 Cloudflare 資料中心為範圍，不是全球精確計數；它用來攔截大量濫用，不作為計費或安全身分判斷依據。
- 登入、寫入、管理 API 與編輯後的強制更新一律回傳 `Cache-Control: no-store`，不會進入公開快取。

## 爬蟲與濫用防護

- `robots.txt` 允許搜尋引擎索引公開內容頁，但禁止索引 API、登入、輸入與管理頁，並拒絕數個常見 AI 訓練爬蟲。
- 所有 API 回應帶有 `X-Robots-Tag: noindex, nofollow`；robots 規則是自願遵守，不能單獨阻止惡意爬蟲。
- 正式網域啟用後，應在 Cloudflare Security Settings 開啟免費的 Bot Fight Mode 與 Block AI Bots。前者可能有誤判，啟用後需查看 Security Events。
- 目前只有授權編輯者能寫入，另有 Worker Rate Limiting。未來若開放一般使用者投稿，再於投稿表單加入 Turnstile，不提前增加目前的輸入摩擦。
- 公開內容本質上無法保證不被複製；防護目標是讓大量抓取被限速或挑戰，並讓正常搜尋引擎與讀者仍能使用網站。

## 尚未啟用

多人公開投稿、揪團、廣告、BGG 串接與完整離線雙向同步刻意不在 MVP 內。首頁與遊戲頁可快取；未送出的輸入保存在 IndexedDB。
