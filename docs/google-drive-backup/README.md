# Google Drive Workspace 備份

Workspace 只以本機 IndexedDB 儲存資料。備份與還原直接連線 Google Drive，整個 Workspace 不使用 D1、網站 session、KV、Durable Objects 或伺服器持有的 Google 憑證。

目前的檔案、資料遺失防護、版本檢查、清理及請求預算以 [獨立快照契約](snapshot-v3.md) 為準。[data-contract.md](data-contract.md) 僅記錄 v1／v2 歷史格式，供舊備份相容還原使用。

每次備份建立獨立資料夾，包含 `manifest.xlsx` 與全部表格 XLSX，索引最後上傳。新版不建立雲端 JSON 收據或作業租約。兩表正常備份 5 次 API 呼叫；保留三份，需回收超額版本時整個單次備份子資料夾移到垃圾桶，再加 1 次，不動備份根目錄。

Google Drive 授權與網站登入分離。公開 `/api/workspace-config` 提供 Client ID；權杖只存在頁面記憶體並直接送給 Google。使用者授權後可在當次網頁工作階段自動備份；關頁後不保留 token，也沒有後端排程上傳。

空白、來源身分不符或尚未確認匯入時停止自動備份。還原先下載並驗證，再進入既有合併／取代預覽，只有使用者確認後才改寫本機資料。

本機匯出仍使用 ZIP，包含索引與逐表 XLSX；一般表格的欄位設定、公式及修訂格式維持相容。既有單一 Workspace XLSX 與 v1／v2 備份仍可還原。

維護時執行 `npm run typecheck`、相關測試及 `npm run test:core:e2e`。後者同時包含手機備份進度與還原 E2E；發布透過 `npm run deploy` 執行相同檢查。
