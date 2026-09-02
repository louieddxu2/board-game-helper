# 開源說明

## 一句話

**這個 repository 是給想研究或抽取程式碼的人，不是給想取得正式資料庫內容的人。**

本專案仍是桌遊應用；開源不代表要把它改造成通用平台。

## 這份 repo 適合誰？

### 想研究程式的人

你可以用 AI 或自行閱讀，挑出 Workspace、離線同步、成對比較、審核流程、Cloudflare Worker／D1 等實作，改成自己的程式。

### 想自架的人

你可以用相同的程式、schema 和測試建立自己的服務，但要使用自己的 Cloudflare 資源、帳號設定和內容資料。

### 想取得內容的人

這不是你的資料來源。正式站的規則、遊戲、評分、投稿、使用者和其他 D1 資料不隨程式碼開源。

## 三個功能要看什麼

### 1. 規則知識庫

網站收集「容易玩錯的桌遊規則」，並提供來源、投稿、人工審核、修訂與衝突處理。

想研究這條流程，依序看：

```text
src/shared/types.ts
→ src/lib/api.ts
→ worker/routes/games.ts
→ worker/routes/rules.ts
→ worker/routes/submissions.ts
→ worker/routes/review.ts
→ docs/review-workflow.md
```

可抽取的概念是「有來源、可審核、可追蹤版本的知識項目」；遊戲名稱、規則文字和標籤仍是桌遊內容。

### 2. 成對比較與屬性評分

使用者比較兩個遊戲在某項屬性上的差異，也可以直接評分；系統累積回答並更新群體結果，支援離線回答和增量目錄同步。

想研究這條流程，依序看：

```text
src/shared/types.ts
→ src/lib/attributeQuestion.ts
→ src/lib/attributeSession.ts
→ src/lib/attributeRatingSuggestion.ts
→ src/pages/AttributesPage.tsx
→ worker/data/attributes.ts
→ worker/routes/attributes.ts
```

可抽取的概念是「subjects × attributes 的群體量測」；目前的屬性、尺度和 BGG／GeekGroup 匯入都是桌遊設計。

### 3. 動態表格 Workspace

Workspace 是本機資料優先的動態表格，包含欄位型態、篩選、批次編輯、XLSX 匯入／匯出、歷史紀錄和 Google Drive 備份。

想研究這條流程，依序看：

```text
src/workspace/types.ts
→ src/workspace/model.ts
→ src/workspace/db.ts
→ src/workspace/spreadsheet.ts
→ src/pages/WorkspacePage.tsx
```

目前 Google Drive 是備份／還原，不是即時同步；多人協作、跨裝置合併和權限模型不在這個 Workspace 的範圍內。

## 可以取用什麼？

可以研究、修改和套用：

- 前端、Worker、API、共用型別與演算法。
- IndexedDB、離線佇列、快取、Workspace 資料格式和 XLSX 處理。
- 投稿、審核、修訂、來源和衝突處理的程式。
- 成對比較、評分聚合、目錄版本和同步的程式。
- schema、index、trigger、migration 機制、測試和技術文件。

## 不可以取用什麼？

以下內容不屬於程式碼開源範圍：

- 正式 D1 的遊戲、別名、規則、標籤、來源和作者文案。
- 屬性定義、翻譯、初始評分、直接評分和成對比較結果。
- 使用者、Session、投稿、審核、投票、收藏、瀏覽統計和活動紀錄。
- 正式 D1 dump、備份、快照、匯出檔和其他營運資料。

部分 migration 同時含有 schema 和 `INSERT` 初始化資料。可以參考 schema 邏輯，但不要把實際資料列複製成自己的資料集。網站或 API 的正常讀取權，也不等於整批資料的重製或再散布權。

## 自架與貢獻

自架時請從 [README 本機開發](../README.md#本機開發) 開始，使用自己的 D1、secrets、OAuth 設定和資料。

貢獻可以是 bug 修正、測試、文件、可及性、效能、安全性、翻譯或開發工具改善。不要提交 production D1、私人匯入檔、備份、token、帳號資料或未確認授權的內容；也不需要為了「通用化」而改動產品方向。

程式碼的正式授權以 repository 根目錄的 `LICENSE` 為準；內容資料需要另外取得授權。

## 給 AI 的提示

```text
請把這個 repository 當成可研究的程式碼，不要當成資料集。
我只想研究［Workspace／成對比較／規則審核／整體架構］。
請列出閱讀順序，說明哪些部分可以抽取、哪些部分綁定桌遊。
不要重現 migrations 或 API 中的正式遊戲、規則、屬性、評分或使用者資料。
```
