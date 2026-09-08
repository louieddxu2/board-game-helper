# 雙極屬性：資料結構與方向轉換

目前完成結構相容、方向轉換、投票 UI、現有瀏覽介面，以及第五步唯讀換算預覽。尚未新增或啟用合併屬性、修改既有分數。

- `attributes.scale_type`：`unipolar`（預設）或 `bipolar`。
- `attribute_translations.endpoints_json`：兩端各有 `label`、`question`，以及可選的 `shortDescription`、`fullDescription`；以 `low`、`high` 指向資料的固定方向。
- `AttributeQuestion.highPole`：本題顯示為 10 的概念端；省略等同固定方向的 `high`。雙端新題由伺服器各以 50% 機率選端，單端維持舊行為。
- 舊快照沒有新增欄位時繼續視為單端。雙端資料若缺少名稱或題目，讀取時拒絕，避免呈現方向不完整的問題。
- 定義查詢、週快照、增量與本機目錄合併保留雙端文字；無須調整 IndexedDB object store。

得分取勝／條件取勝的端點說明在建立合併資料時，直接從當時的兩筆 `attribute_translations` 複製原文，不重寫。這一步沒有修改任何作者文字或評分。

## 第二步：方向轉換

- 目前評分範圍為 0–10；`orientAttributeScore` 在反向題使用 `10 - score`，正向維持原值，可用於顯示及回存。
- 比較回答反向時交換 A_HIGHER／B_HIGHER，SIMILAR、空值保持原意。
- HTTP 與離線佇列保存當題顯示方向的答案與 highPole。伺服器驗證簽章中的方向，進入計分前轉換一次；固定方向的答案寫入既有 rating/comparison 欄位，確保歷史重算不重複反轉。
- migration 0084 在回應資料新增 question_high_pole，能依固定方向答案還原當時的回答；既有回應預設 high。
- 本機個人評分紀錄及樂觀活動使用固定方向；佇列原始物件不變，重送沿用 responseId，既有去重機制避免再次計分。
- 舊簽章缺少方向等同 high；不能被改成 low。單端屬性拒絕 low 回答。

## 第三步：投票 UI

- 題目與說明使用本題高分端的 `question`、`shortDescription ?? fullDescription`，不改寫既有原文。
- 範例與直接評分軸皆標示本題 0／10 對應的概念；反向題的範例使用 `10 - score`，不改動快取。
- 遊戲卡片及投票回饋顯示「更偏哪一端」，鍵盤與拖曳評分同樣以本題方向操作。
- 新組合重新選端；只換一款遊戲時將原 highPole 傳回伺服器並簽章。React 重繪、快取讀取及離線重送不重新抽方向。
- 驗證：雙方向頁面測試、出題路由與簽章測試；`npm run build` 後執行 `node scripts/verify-bipolar-ui.mjs` 可用隔離 API fixtures 重現 1280px／390px 畫面及送出。截圖寫入 `outputs/bipolar-ui/`，不含正式遊戲評分。

## 第四步：現有瀏覽介面

- 總表欄頭固定標示 0／10 兩端，升降冪分別顯示偏低端／高端優先。分數、未知值、候選值及相近遊戲計算維持原樣，不因投票方向轉換。
- 兩端原文可展開閱讀，手機不依賴滑鼠懸停；儲存格的輔助閱讀文字包含固定方向。
- 新活動快照保存 `attributePoles` 標籤，與固定方向答案一起讀回。樂觀記錄與伺服器記錄皆描述哪款更偏固定高端，不受當題方向影響；舊单端記錄維持原文字。
- 檢視後確認目前 GamePage 沒有屬性區塊，因此本步不新增額外遊戲頁區塊。
- 隔離瀏覽器驗證擴充至投票後近期活動、進入總表、展開原文及固定方向排序。

## 第五步：唯讀換算預覽

- [2026-09-08 完整報告](attribute-win-merge-preview-2026-09-08.md) 與 [可回溯來源狀態](attribute-win-merge-preview-2026-09-08.json) 已產生。資料取自公開快照並套用增量至版本 8109。
- 重跑：`npx tsx scripts/preview-win-merge.ts https://board-game-helper.louieddxu2.workers.dev`；也接受本機 AttributeCatalogPayload JSON。只輸出 JSON（含 Markdown），不寫入資料庫或檔案。
- `scripts/bipolar-merge-preview.ts` 提供純換算與報告產生函式。零證據的初始 5 分視為未知；缺一端用另一端，缺兩端保持未知。
- 五款校正透過精確 subject ID 套入預覽，缺任何目標就中止；快餐的兩個來源值不校正。保留每個來源的證據數、RD 與模型版本，不合計成新證據。
- 230 個遊戲／配置中 108 個可換算、122 個未知；五款校正只改預覽輸入，不覆寫舊投票或合成分數。未對應候選分開列出。
- 測試可從保留的來源狀態重建報告，核對公式、指定校正、原文與全部結果。

下一步設計並驗證正式啟用的初始狀態、來源保留與回復方式，再套用合併屬性；本次不建立或啟用正式合併屬性。

已整理[啟用設計與必要驗收](attribute-win-activation-plan.md)：首次零票覆蓋、背景重建與離線舊題相容性都需先處理，不能只新增分數再停用兩個舊欄位。

第六步進行中：已實作初始值獨立儲存、首票更新、背景重建還原，以及公開目錄／總表的換算初始值標記（migration 0085）。另以 migration 0086 建立舊題 source→target 映射與 response 收據，migration 0087 讓目錄增量也保留初始值旗標；寫入層會依映射固定方向轉換分數與 A/B 比較，並保留版本可查核。實際資料庫測試涵蓋重送去重、歷史切換邊界與舊題反向映射。正式批次填入、遊戲合併初始值映射、原子切換與回復仍未完成，正式合併仍未啟用。

部署需先套用 migration 0083、0084、0085、0086、0087，再以受控批次填入 mapping／初始值並啟用讀取新欄位的程式；本步不執行正式環境 migration 或部署。
