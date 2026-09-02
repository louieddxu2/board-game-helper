# 專案功能與開源使用方式

## 三個功能

### 1. 桌遊規則勘誤資料庫

這個網站讓玩家查找一款桌遊中「容易玩錯的規則」。每筆內容可以附上來源、適用版本和相關標籤；使用者可以投稿，編輯者可以修改、審核，系統會保留修訂紀錄並處理版本衝突。

它不是完整規則書，而是專門記錄「實際玩遊戲時容易弄錯的地方」。

這個功能的核心做法是：把一個知識項目和它的來源、版本、審核狀態及修改歷史放在一起管理。

### 2. 桌遊屬性比較與評分

這個功能讓使用者比較兩款遊戲在某項屬性上的差異，也可以直接為遊戲打分。系統收集許多人的回答，再整理成屬性結果。

它包含題目選擇、重複回答避免、直接評分、成對比較、離線回答、重新連線同步和版本化目錄。

這個功能的核心做法是：以「對象 × 屬性」收集群體判斷，再由系統聚合結果。目前的對象、屬性和評分方式都是為桌遊設計的。

### 3. 離線動態表格 Workspace

Workspace 讓使用者在瀏覽器中建立資料夾和表格，設定欄位型態，編輯、篩選和批次修改資料。資料會先存在本機，即使離線也能使用；表格可以匯入／匯出 XLSX，也可以備份到使用者自己的 Google Drive。

這個功能的核心做法是：用 IndexedDB 保存本機資料和修改歷史，並把表格資料與欄位設定一起保存。

目前 Google Drive 是備份／還原，不是即時同步；Workspace 沒有多人協作或跨裝置自動合併。

## 開源後可以如何使用？

開源的目的，是讓開發者研究上面的實作，並取用自己需要的部分。你可以：

- 研究整個網站如何由 React PWA、Cloudflare Worker、D1 和 IndexedDB 組成。
- 只取用 Workspace 的離線表格、XLSX 處理或本機儲存。
- 只取用屬性比較的題目選擇、評分聚合或離線同步。
- 只取用規則投稿、來源、審核、修訂和衝突處理。
- 用相同的程式和 schema 自架一個自己的版本。
- 使用 AI 協助閱讀，再把適合自己的程式改寫到其他專案。

不需要使用完整網站，也不需要把它改造成通用框架。桌遊只是目前的產品情境；其他領域的使用者要自行替換遊戲名稱、欄位、文案、資料來源和權限規則。

## 從哪裡開始閱讀？

先看 `README.md`、`src/App.tsx`、`src/shared/types.ts` 和 `worker/index.ts`，了解整體結構。接著依照你想研究的功能閱讀：

- **規則資料庫**：`src/shared/types.ts` → `src/lib/api.ts` → `worker/routes/games.ts`、`rules.ts`、`submissions.ts`、`review.ts` → `docs/review-workflow.md`
- **屬性比較**：`src/shared/types.ts` → `src/lib/attributeQuestion.ts`、`attributeSession.ts` → `src/pages/AttributesPage.tsx` → `worker/data/attributes.ts`、`worker/routes/attributes.ts`
- **Workspace**：`src/workspace/types.ts` → `model.ts` → `db.ts` → `spreadsheet.ts` → `src/pages/WorkspacePage.tsx`

想自架時，再閱讀 README 的本機開發流程、`wrangler.jsonc`、`.dev.vars.example` 和 `migrations/`。自架需要使用自己的 Cloudflare 資源、OAuth 設定、secrets 和內容資料。

## 內容資料不開源

開源的是程式和技術實作，不是正式服務的資料庫內容。以下內容不在開源範圍：

- 正式 D1 的遊戲、別名、版本、規則、標籤、來源和作者文案。
- 屬性定義、翻譯、初始評分、直接評分和成對比較結果。
- 使用者、投稿、審核、投票、收藏、瀏覽統計、Session 和其他營運紀錄。
- 正式 D1 dump、備份、快照和匯出檔。

部分 migration 同時包含 schema 和 `INSERT` 初始化資料。可以參考 schema、index、trigger 和 migration 邏輯，但不要把實際資料列複製成自己的資料集。網站或 API 的正常讀取權，也不等於整批資料的重製或再散布權。

自架或測試時請使用自己建立的資料，或另外取得授權的 demo data。

## 貢獻範圍

歡迎 bug 修正、測試、文件、可及性、效能、安全性、翻譯和開發工具改善。請不要提交 production D1、私人匯入檔、備份、token、帳號資料或未確認授權的內容。

本專案仍以桌遊產品為中心。開源是分享程式實作，不是請社群替它設計成另一個通用產品。

程式碼的正式授權以 repository 根目錄的 `LICENSE` 為準；內容資料需要另外取得授權。
