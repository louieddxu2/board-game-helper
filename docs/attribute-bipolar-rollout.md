# 雙極屬性：資料結構與方向轉換

目前完成第一步結構相容及第二步方向轉換，尚未新增或啟用合併屬性、換算分數、翻轉投票 UI。

- `attributes.scale_type`：`unipolar`（預設）或 `bipolar`。
- `attribute_translations.endpoints_json`：兩端各有 `label`、`question`，以及可選的 `shortDescription`、`fullDescription`；以 `low`、`high` 指向資料的固定方向。
- `AttributeQuestion.highPole`：本題顯示為 10 的概念端；省略等同固定方向的 `high`。目前出題仍保持原方向，待 UI 完成後才啟用隨機選端。
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

下一步完成投票 UI 及隨機選端，再完成瀏覽 UI，最後套用已確認的五款校正和平均換算。UI 完成前不啟用雙端抽題。

部署需先套用 migration 0083、0084 再啟用讀取新欄位的程式；本步不執行正式環境 migration 或部署。
