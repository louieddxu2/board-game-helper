# 開源使用說明

## 先看這裡：本專案開源什麼？

重點只有三句話：

1. **可以拿程式碼去研究、修改及套用。**
2. **不可以把正式服務的 D1 內容當成開源資料集。**
3. **本專案仍是桌遊應用，不會為了開源而改造成通用平台。**

換句話說，這個 repository 是「可研究的應用程式」，不是「可以下載完整資料庫的資料專案」，也不是「安裝後就適合任何領域的框架」。

## 你是哪一種讀者？

| 你的目的 | 你可以做什麼 | 從哪裡開始 |
| --- | --- | --- |
| 想研究或抽取程式碼 | 挑需要的模組，改成自己的實作 | 看下方「功能閱讀入口」 |
| 想自架網站 | 使用相同程式、schema 和測試，填入自己的 Cloudflare 資源與自己的資料 | [README 本機開發](../README.md#本機開發)、`wrangler.jsonc`、`.dev.vars.example` |
| 想貢獻程式 | 提交 bug 修正、測試、文件、可及性、效能或安全改善 | 看下方「貢獻者要知道什麼？」 |
| 想取得正式內容 | 只能依正式網站的正常使用方式閱讀 | 不要從 repository 或 API 建立資料集 |
| 想用 AI 研究 | 明確指定功能、檔案範圍及不要重現內容資料 | 看下方「給 AI 的閱讀方式」 |

## 可以取用的部分

開源範圍是程式與技術實作，包括：

- React／Vite 前端、Cloudflare Worker、API 路由與共用型別。
- IndexedDB、本機離線佇列、快取、同步及 Workspace 資料結構。
- 規則投稿、審核、修訂、來源與衝突處理的實作。
- 成對比較、直接評分、題目選擇、評分聚合與版本化目錄的實作。
- 資料庫 schema、index、trigger、migration 機制、測試、部署腳本及技術文件。

可以只取用其中一部分；不需要接受整個網站的產品方向。

## 不可以當成開源資料的部分

正式服務的 D1 內容全部不在程式碼開源範圍內，包括：

- 遊戲、別名、版本、規則、標籤與來源內容。
- 屬性定義、翻譯、初始評分、直接評分及成對比較結果。
- 使用者、Session、投稿、審核、投票、收藏、瀏覽統計及活動紀錄。
- 正式 D1 dump、備份、快照、匯出檔及其他營運資料。

網站或公開 API 讓你讀到資料，只代表可以使用服務，不代表可以整批複製、再散布或建立衍生資料庫。

### 閱讀 migration 時的規則

目前有些 migration 同時包含 schema 和 `INSERT` 初始化資料：

- `CREATE TABLE`、index、trigger、view 和 migration 邏輯：視為程式／schema 參考。
- 實際遊戲、屬性、翻譯、評分及來源資料列：視為內容資料，不要複製到自己的資料集。

因此，自架者應使用自己建立的資料或另外取得授權的 demo data。Production D1、正式備份與完整資料快照不應放入 fork、release 或測試 fixture。

## 功能閱讀入口

### 只想取用動態表格 Workspace

適合想研究離線表格、欄位型態、批次編輯、XLSX 匯入匯出或本機歷史紀錄的人。

依序閱讀：

1. `src/workspace/types.ts`：`WorkspaceData`、`WorkspaceTable`、`WorkspaceColumn`、`WorkspaceRow`。
2. `src/workspace/model.ts`：欄位型態、值的正規化、顯示與篩選。
3. `src/workspace/db.ts`：IndexedDB 儲存、寫入佇列與歷史紀錄。
4. `src/workspace/spreadsheet.ts`：XLSX 匯入／匯出格式。
5. `src/pages/WorkspacePage.tsx`：頁面操作與元件組合。

目前 Workspace 是「本機資料優先」；Google Drive 是備份／還原，不是即時同步。跨裝置同步、多人協作與衝突合併不在目前範圍內。

### 只想取用成對比較評分

適合想研究「讓使用者回答少量比較題，再累積群體排序」的人。

依序閱讀：

1. `src/shared/types.ts`：attribute 相關型別。
2. `src/lib/attributeQuestion.ts`、`attributeSession.ts`、`attributeRatingSuggestion.ts`：題目與回答模型。
3. `src/pages/AttributesPage.tsx`：回答、離線佇列與同步。
4. `worker/data/attributes.ts`、`worker/routes/attributes.ts`：伺服器端資料流。
5. `migrations/0040_attribute_subjects.sql` 及後續 attribute migrations：需要了解 schema 時再看。

目前的 subject、attribute、評分尺度與外部 ID 都以桌遊為前提；取用到其他領域時，請自行重新定義它們。

### 只想取用規則知識庫流程

適合想研究有來源、可投稿、可人工審核、可追蹤修訂的知識項目。

依序閱讀：

1. `src/shared/types.ts`：game、rule、submission、review 相關型別。
2. `src/lib/api.ts`：前端 API 邊界。
3. `worker/routes/games.ts`、`rules.ts`、`submissions.ts`：遊戲、規則與投稿。
4. `worker/routes/review.ts`、`worker/review.ts`：提案、版本、衝突與人工決定。
5. [校稿工作流](./review-workflow.md)：匯出、AI／人工校稿及提案匯入。

這套流程收集的是「容易玩錯的規則」，不是完整規則書。套用到其他知識時，必須自行處理來源權利、審核責任與錯誤風險。

## 自架者要自己負責什麼？

自架代表你建立一個自己的服務，不是取得原正式站的副本。你要自行準備及負責：

- Cloudflare Worker、D1、secrets、OAuth client 及網域。
- 自己擁有或獲得授權的內容資料。
- 隱私政策、帳號刪除、備份、內容審核及漏洞回報。
- 自己的 API 使用限制與資料匯出規則。

相同的 schema 不會帶來正式資料的使用權；相同的前端程式也不會自動連到原本的正式 D1。

## 貢獻者要知道什麼？

歡迎改善目前這個桌遊應用的實作品質，例如：

- bug 修正、測試、可及性、效能與安全性。
- 文件、翻譯、開發工具與 self-hosting 說明。
- 不擴大資料責任範圍的匯入／匯出改善。

請不要提交 production D1、私人匯入檔、Google Drive 備份、token、帳號資料或未確認授權的內容。也不要只因為「其他領域可能用得到」就要求新增通用設定、模板或 adapter；本專案的產品方向仍然是桌遊。

## 給 AI 的閱讀方式

請一次指定一個功能和一個結果，並提醒 AI 不要重現 D1 內容。例如：

```text
請只研究 src/workspace。
我要了解 IndexedDB 儲存、XLSX 匯入匯出和歷史紀錄的資料流。
請依 types.ts → model.ts → db.ts → spreadsheet.ts → WorkspacePage.tsx 說明，
不要重現 migrations 中的遊戲、屬性或評分資料，也不要把 Google Drive 當成即時同步服務。
```

好的研究問題是：

- 哪些檔案組成這個功能？
- 哪些型別是桌遊專屬，哪些可以直接抽取？
- 這段程式依賴哪些 schema？
- 若使用自己的資料，最小 demo 需要哪些 fixture？
- 這個流程有哪些離線、權限或資料責任假設？

## 授權提醒

程式碼是否正式取得開源授權，以 repository 根目錄的 `LICENSE` 為準；本文件不取代授權檔。內容資料則必須有獨立的資料授權，不能直接套用程式碼授權。

最簡單的判斷方式是：

> 想研究「怎麼做」：可以看、可以改、可以取用。
>
> 想取得「正式站存了什麼」：不在本專案的開源範圍內。
