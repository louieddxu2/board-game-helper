# 為什麼開源這個專案，以及你應該怎麼讀

## 如果你是第一次來，先看這段

這個 repository 公開的目的，是讓開發者研究一個真實運作中的桌遊網站，並從中挑出自己需要的實作。你可以用 AI 協助閱讀，也可以直接沿著檔案追程式；你不需要理解或採用整個產品。

這不是一個「下載後就能管理任何領域資料」的通用平台，也不是一個「可以順便下載完整桌遊資料庫」的資料專案。

最適合這個 repository 的讀者，是想回答以下問題的人：

- 一個離線優先的 React PWA 如何儲存、快取、同步和匯出資料？
- 一個 Cloudflare Worker／D1 網站如何處理登入、權限、投稿、審核和版本衝突？
- 如何用成對比較和直接評分累積一組群體屬性結果？
- 一個真實產品如何把桌遊需求落成可測試的前端、API 和資料庫？

如果你想取得正式站的規則、遊戲、評分或使用者資料，這個 repository 不是你的資料來源。

## 你讀完這份說明後，應該能做什麼？

你應該能夠：

1. 判斷這個專案是否有你想研究的實作。
2. 直接找到該實作的主要檔案，而不用從五百多個 commit 開始讀。
3. 分辨哪些程式可以抽取，哪些地方仍依賴桌遊語境。
4. 知道哪些資料可以放進自己的 demo，哪些正式內容不能複製。
5. 判斷自己要做的是「研究程式碼」、「自架自己的服務」，還是「使用正式網站」——這三件事不是同一件事。

## 這個專案本身在做什麼？

「玩錯的桌遊規則」是一個公開閱讀的桌遊規則踩雷資料庫。使用者查找某款遊戲時，看到的是遊玩時容易搞錯的規則、常見錯誤情況、來源與相關標籤；編輯者可以投稿、修改、審核並留下修訂紀錄。

除了規則庫，網站還有兩個獨立但同樣重要的部分：

### 規則知識庫

它示範如何維護一種需要來源、人工確認和版本追蹤的社群知識。可研究的重點是：

- 遊戲名稱與別名解析。
- 規則、來源、標籤與修訂紀錄。
- 投稿、人工審核、提案、衝突偵測與軟刪除。
- 公開唯讀 API 與受權限保護的寫入流程。

它不是完整規則書，也不是鼓勵把任何高風險知識直接交給未審核內容的框架。

### 成對比較與屬性評分

它讓使用者比較兩款遊戲在某項屬性上的差異，也可以留下直接分數，系統再累積群體結果。可研究的重點是：

- 如何選下一個比較題目。
- 如何避免同一個 session 重複回答。
- 如何處理離線回答、重新連線和失敗重試。
- 如何把直接評分與成對比較聚合成可讀結果。
- 如何用版本化目錄讓前端增量同步。

目前的 subject、attribute、評分尺度及 BGG／GeekGroup 匯入都是桌遊設計。把它改成商品、課程或媒體比較時，領域定義和偏差處理要由你重新決定。

### 動態表格 Workspace

它是一個本機資料優先的動態表格，支援資料夾、多張表格、欄位型態、篩選、批次編輯、XLSX 匯入／匯出、歷史紀錄和 Google Drive 備份。可研究的重點是：

- IndexedDB 的逐表儲存與寫入佇列。
- typed cell、動態選單和表格資料正規化。
- 貼上矩陣、XLSX round-trip 及匯入預覽。
- 前景工作階段中的備份、還原與離線狀態。

目前它不是多人即時表格，也不是跨裝置同步服務。想要那些能力的人需要自行增加權限、同步和衝突模型。

## 依你的目的開始閱讀

### 我想先理解整個網站

依這個順序讀：

1. [README](../README.md)：本機開發、驗證、部署和 API 的整體邊界。
2. `src/App.tsx`：前端路由和頁面入口。
3. `src/shared/types.ts`：前端與 API 共用的資料形狀。
4. `src/lib/api.ts`：瀏覽器如何呼叫 Worker。
5. `worker/index.ts`：CORS、session middleware、公開／受保護路由。
6. 最後選一個功能，依下方的功能路徑深入。

### 我只想研究 Workspace

讀 `src/workspace/types.ts` → `model.ts` → `db.ts` → `spreadsheet.ts` → `src/pages/WorkspacePage.tsx`。

先看 types 和 db 可以理解資料怎麼保存，再看 spreadsheet 和 page 如何把資料轉成使用者操作。Google Drive 部分從 `src/workspace/googleDriveBackup/` 和 [備份文件](./google-drive-backup/README.md) 開始。

### 我只想研究屬性比較

讀 `src/shared/types.ts` 的 attribute 型別 → `src/lib/attributeQuestion.ts`、`attributeSession.ts`、`attributeRatingSuggestion.ts` → `src/pages/AttributesPage.tsx` → `worker/data/attributes.ts` → `worker/routes/attributes.ts`。

需要了解 D1 結構時，才讀 `migrations/0040_attribute_subjects.sql` 及後續 attribute migrations。

### 我只想研究規則投稿與審核

讀 `src/shared/types.ts` 的 game／rule／submission／review 型別 → `src/lib/api.ts` → `worker/routes/games.ts`、`rules.ts`、`submissions.ts` → `worker/routes/review.ts`、`worker/review.ts` → [校稿工作流](./review-workflow.md)。

這條路徑可以看懂「匯出給人工或 AI 校稿，但匯入只建立提案，不直接覆蓋正式資料」的完整流程。

### 我想自架自己的版本

請把它當成「用相同程式建立另一個服務」，不是「複製正式站」。先讀 [README 本機開發](../README.md#本機開發)，再看 `wrangler.jsonc`、`.dev.vars.example` 和 `migrations/`。

你要自行提供 Cloudflare Worker、D1、secrets、OAuth 設定、管理員、備份、隱私政策和內容資料。相同的 schema 不會給你正式 D1 的使用權，也不會讓 fork 自動連到正式 API。

## 開源與資料的界線

### 可以研究、修改及套用

範圍包括：

- 前端、Worker、API 路由、共用型別和演算法。
- IndexedDB、離線佇列、快取、Workspace 資料格式與 XLSX 處理。
- 規則投稿、審核、修訂、來源和衝突處理的程式。
- 屬性題目、評分聚合、目錄版本和同步的程式。
- schema、index、trigger、migration 機制、測試、部署腳本和技術文件。

你可以只取用其中一部分；不需要把專案改造成通用平台，也不需要採用原本的桌遊 UI。

### 不可以從這裡建立內容資料集

正式服務的 D1 內容全部不在程式碼開源範圍內，包括：

- 遊戲、別名、版本、規則、標籤、來源內容及作者文案。
- 屬性定義、翻譯、初始評分、直接評分與成對比較結果。
- 使用者、Session、投稿、審核、投票、收藏、瀏覽統計和活動紀錄。
- 正式 D1 dump、備份、快照、匯出檔及其他營運資料。

目前有些 migration 同時包含 schema 和 `INSERT` 初始化資料。閱讀 `CREATE TABLE`、index、trigger、view 和 migration 邏輯沒有問題；但實際遊戲、屬性、翻譯、評分與來源資料列不能直接當成自己的 seed。

網站或公開 API 讓你讀到資料，只代表可以使用服務，不代表可以整批複製、再散布、建立衍生資料庫或訓練另一個內容庫。

## 如果你要貢獻

歡迎改善目前這個桌遊應用的實作品質：bug 修正、測試、可及性、效能、安全性、文件、翻譯、開發工具及不擴大資料責任的匯入／匯出改善。

不要提交 production D1、私人匯入檔、Google Drive 備份、token、帳號資料或未確認授權的內容。也不要只因為其他領域可能用得到，就要求新增通用設定、模板或 adapter；本專案的產品方向仍然是桌遊。

## 給 AI 的最短閱讀提示

```text
請把這個 repository 當成「可研究的程式碼」，不要當成資料集。
我的目的是研究：［填入 Workspace／屬性比較／規則審核／整體架構］。
請先列出閱讀順序，再說明哪些部分可以抽取、哪些部分綁定桌遊。
不要重現 migrations 或正式 API 中的遊戲、規則、屬性、評分或使用者資料。
```

## 授權提醒

程式碼是否正式取得開源授權，以 repository 根目錄的 `LICENSE` 為準；本文件不取代授權檔。內容資料必須另外處理，不能因為和程式碼放在同一個 repository 或 SQL 檔，就自動適用程式碼授權。

最簡單的判斷方式是：

> 想研究「這個網站怎麼做」：這個 repository 是給你的。
>
> 想取得「正式站存了什麼」：這個 repository 不是給你的。
