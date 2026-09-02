# 給研究者、取用者與自架者的開源說明

## 先判斷你要做什麼

這個 repository 是「玩錯的桌遊規則」的完整應用程式原始碼。它不是一個已經整理好的通用框架，也不包含正式站的 D1 dump；不過部分 migration 同時包含 schema 和初始化資料列，這些資料列的處理方式見下方「SQL 檔不等於全部都是可自由使用的程式碼」。

請依你的目的閱讀：

| 你的目的 | 先讀哪裡 | 接著讀哪裡 | 你可以期待的結果 |
| --- | --- | --- | --- |
| 了解整體架構 | [README](../README.md)、`src/App.tsx` | `src/shared`、`worker/index.ts` | 知道前端路由、API、D1、IndexedDB 如何連接 |
| 只取用動態表格 | `src/workspace/types.ts` | `model.ts` → `db.ts` → `spreadsheet.ts` → `WorkspacePage.tsx` | 抽取本機 typed table、匯入匯出或歷史紀錄設計 |
| 研究成對比較評分 | `src/shared/types.ts` 的 attribute 型別 | `src/lib/attribute*` → `src/pages/AttributesPage.tsx` → `worker/data/attributes.ts` | 了解題目選擇、離線回答、聚合評分與目錄同步 |
| 研究規則知識庫 | `src/shared/types.ts` 的 game／rule 型別 | `worker/routes/games.ts`、`rules.ts`、`submissions.ts`、`review.ts` | 了解投稿、來源、版本、審核與衝突處理 |
| 自架一個自己的網站 | [本機開發](../README.md#本機開發) | `wrangler.jsonc`、`.dev.vars.example`、`migrations/` | 用自己的 Cloudflare 資源和自己的內容啟動 |
| 研究跨站 API | [OpenAPI v1](./openapi.yaml) | [計分板整合路線](./scorepad-integration.md) | 了解公開讀取、Bearer session 與寫入權限 |
| 只想看目前正式資料 | 不要從 repository 複製 | 依正式網站的正常使用方式瀏覽 | 網站存取不代表取得資料集授權 |

如果你是透過 AI 研究，請在提示中說明你的目的，例如：「只分析 Workspace 的 IndexedDB 和 XLSX 匯出，不要分析或重現 migration 內的遊戲資料」。這樣可以避免 AI 把桌遊內容誤當成可重用的範例資料。

## 所有讀者都要先知道的三件事

### 這是桌遊產品，不是通用平台

產品名稱、頁面文案、規則欄位、BGG／GeekGroup 匯入及部分資料庫內容都以桌遊為前提。你可以把其中的實作當成參考，卻不應假設：

- 所有欄位已適合其他領域。
- 所有名稱已經抽象化。
- fork 後可以直接連到原本的正式 API 或資料庫。
- 維護者會替你的領域增加設定、模板或 adapter。

「可跨領域參考」表示你可以自行取用有價值的實作，不表示本專案會替其他領域提供產品支援。

### 開源的是實作，不是正式資料

可研究和再利用的範圍包括前端、Worker、測試、共用型別、演算法、資料庫結構、migration 機制、部署腳本、API 規格及技術文件。

不在開源範圍的是正式 D1 中保存的內容，包括遊戲與別名、規則、標籤、屬性定義、評分、投票、投稿、審核、使用者、Session、收藏、瀏覽統計、備份及其他營運紀錄。作者文案、投稿者內容及第三方來源也不會因為出現在網站或 SQL 中就自動取得開源授權。

正式網站或公開 API 讓你讀到資料，是使用服務的必要功能，不等於允許整批下載、重製、再散布、建立衍生資料集或訓練另一個內容庫。

### SQL 檔不等於全部都是可自由使用的程式碼

部分 migration 同時放了 schema 和實際 `INSERT` 資料。閱讀時請將兩者分開：

- `CREATE TABLE`、欄位限制、index、trigger、view 及 migration 邏輯，是程式／schema 層。
- 實際的遊戲、屬性、翻譯、評分、來源識別及其他資料列，是內容資料層。
- 不要把 production D1 dump、正式備份或完整公開資料快照提交到自己的 fork。
- 自架時請使用自己建立的資料，或使用有清楚授權的 demo data。

正式發布時，repository 根目錄的 `LICENSE`、資料邊界聲明及各資料來源的個別條款共同決定可用範圍。只有 repository 可見，並不代表已經取得開源授權。

## 如果你只想取用其中一部分

### A. 取用 Workspace

適合想要離線表格、資料夾、欄位型態、批次編輯或 XLSX 往返的人。

建議閱讀順序：

1. `src/workspace/types.ts`：先看資料結構。核心物件是 `WorkspaceData`、`WorkspaceTable`、`WorkspaceColumn` 和 `WorkspaceRow`。
2. `src/workspace/model.ts`：看值的正規化、欄位型態、顯示、篩選及動態選單。
3. `src/workspace/db.ts`：看 IndexedDB schema、逐表儲存、寫入佇列與歷史紀錄。
4. `src/workspace/spreadsheet.ts`：看 plain table、含設定的單表及整個 Workspace 的 XLSX 匯入／匯出。
5. `src/pages/WorkspacePage.tsx`：最後才看頁面如何組合操作、手勢、對話框、篩選和備份。

目前 Workspace 是本機資料優先。Google Drive 只是使用者主動連結後的備份／還原位置，不是即時資料庫，也沒有多人合併。若你的產品需要跨裝置同步、權限、即時協作或衝突合併，這些都要自行設計。

### B. 取用屬性比較

適合想研究「讓使用者回答少量成對問題，再累積群體排序」的人。

建議閱讀順序：

1. `src/shared/types.ts`：確認 `AttributeSubject`、`AttributeDefinition`、`AttributeQuestion`、`AttributeMatrixValue`。
2. `src/lib/attributeQuestion.ts`、`attributeSession.ts`、`attributeRatingSuggestion.ts`：看題目文字、session、直接評分與下一題建議。
3. `src/lib/attributeCollection.ts`：看收藏範圍與外部 ID 的本機交集。
4. `src/pages/AttributesPage.tsx`：看回答、離線佇列、同步、錯誤與畫面狀態。
5. `worker/data/attributes.ts`、`worker/routes/attributes.ts`：看伺服器端題目、回答、活動與評分資料流。
6. `migrations/0040_attribute_subjects.sql` 及後續 attribute migrations：只在需要了解 D1 結構或版本化目錄時閱讀。

這個系統提供的是群體回應的聚合結果，不是客觀真理，也不代表目前桌遊屬性定義適合你的領域。若換成商品、課程或媒體，應重新定義 subject、attribute、評分尺度、來源及偏差處理。

### C. 取用規則知識庫流程

適合想研究有來源、可審核、可追蹤修訂的知識項目。

建議閱讀順序：

1. `src/shared/types.ts`：先看 `GameSummary`、`GameDetail`、`RuleCard`、`RuleRevision`、`SubmissionInput` 和 `ReviewProposal`。
2. `src/lib/api.ts`：看前端呼叫哪些 API，以及公開讀取與登入後寫入的分界。
3. `worker/routes/games.ts`、`rules.ts`、`submissions.ts`：看遊戲、規則與投稿流程。
4. `worker/routes/review.ts`、`worker/review.ts`：看提案、基準版本、衝突及人工決定。
5. [校稿工作流](./review-workflow.md)：看匯出給人工／AI 校稿後，如何只建立提案而不直接覆蓋正式內容。
6. `migrations/0001_initial.sql` 及其後的 rule／tag／review migrations：需要改 schema 時再看。

現有規則庫收集的是「容易玩錯的規則與錯誤情況」，不是完整規則書。若你把這套流程用於 SOP、設備操作或其他知識，必須重新確認內容責任、來源權利、審核者資格及高風險錯誤的處理方式。

## 如果你想自架

自架者不是在複製正式站，而是在用相同程式建立一個由自己負責的服務。你需要自己準備：

- Cloudflare Worker、D1 和 migration 執行環境。
- 自己的 `APP_ORIGIN`、Google OAuth client、session secrets 及管理員設定。
- 自己擁有或取得授權的遊戲、規則、屬性和其他資料。
- 自己的資料備份、隱私政策、帳號刪除、漏洞回報及內容審核責任。

本機開發可依 [README 的本機開發流程](../README.md#本機開發) 初始化。請不要填入正式站的 D1 ID、secret、Google Drive token 或正式備份。自架版本可以使用相同 schema，但不會因此取得正式資料。

Google 登入只處理身分驗證；Workspace 的 Google Drive 備份是另外的 OAuth 授權。不要把正式服務的 token、Cookie 或 D1 內容放進 issue、PR、測試 fixture 或 AI 提示。

## 如果你想貢獻

貢獻的最小單位可以是文件、測試、bug 修正、可及性、效能、翻譯或開發工具改善。提交前請先確認修改屬於目前產品，而不是只為了讓名稱看起來更通用。

涉及下列內容時，請先在 issue 說明資料與安全影響：

- migration 或正式 D1。
- 使用者、Session、投稿、投票及內容匯出。
- OAuth、Cloudflare 權限、備份或跨站 API。
- 外部資料來源、遊戲名稱、翻譯、作者文案或其他權利問題。

不要提交 production D1 dump、私人匯入檔、Google Drive 備份、token、帳號資料或未確認授權的內容。測試請使用虛構資料或明確可公開的 fixture。

維護者會維持桌遊產品的核心方向；「別的領域也可能用得到」本身不是要求新增抽象層、設定項或 adapter 的理由。

## 如果你只想用 AI 讀懂專案

請把問題限定在一個功能和一個結果。例如：

```text
請只研究 C:\\code\\BoardGameHelper\\src\\workspace。
我要理解 IndexedDB 儲存、XLSX 匯入匯出和 undo/redo 的資料流。
請依 types.ts → model.ts → db.ts → spreadsheet.ts → WorkspacePage.tsx 的順序說明，
不要重現 migrations 中的正式遊戲資料，也不要假設 Google Drive 是即時同步服務。
```

建議一次只問一個問題：

- 「哪幾個檔案組成這個功能？」
- 「哪些型別是領域專屬，哪些可以直接抽取？」
- 「這段程式依賴哪些 D1 schema？」
- 「若移除正式資料，最小可運作 demo 需要哪些 fixture？」
- 「這個流程有哪些離線、權限或資料責任假設？」

不要要求 AI 把所有桌遊內容整理成另一份資料集，也不要把正式資料列當成可以直接搬到新產品的 seed。

## 授權與發布時要確認的事項

程式碼、schema、測試和技術文件需要在 repository 根目錄有明確的 `LICENSE`；本文件本身不取代法律授權。若目標是讓人自由抽取和套用部分實作，Apache-2.0 是適合評估的候選；若希望網路服務的修改版也必須提供源碼，則需另行評估 AGPL-3.0。

資料內容必須另行處理：

- 正式 D1 不放入 release artifact。
- 正式資料的 dump、備份和完整 snapshot 不放入 repository。
- 混合 schema 與 `INSERT` 的 migration 必須在發布文件中標示資料區塊的權利狀態。
- 投稿內容要有投稿者授權與撤回／刪除處理規則。
- BGG、GeekGroup、Google Drive 或其他第三方資料要遵守各自的來源和使用條款。

在上述事項完成前，repository 可以作為研究材料，但不應對外宣稱「所有檔案都已取得相同的開源授權」。

## 一句話版本

如果你是研究者：挑你需要的模組，照閱讀順序理解它。

如果你是自架者：用自己的 Cloudflare 資源和自己的內容建立服務。

如果你是貢獻者：改善實作品質，不必替本專案發明一個通用平台。

如果你是資料使用者：正式 D1 的內容不是 repository 的開源附贈品。
