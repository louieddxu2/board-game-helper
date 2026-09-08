# 雙極屬性：第一步資料結構

目前僅加入結構相容，尚未新增或啟用合併屬性、換算分數、修改投票 UI。

- `attributes.scale_type`：`unipolar`（預設）或 `bipolar`。
- `attribute_translations.endpoints_json`：兩端各有 `label`、`question`，以及可選的 `shortDescription`、`fullDescription`；以 `low`、`high` 指向資料的固定方向。
- `AttributeQuestion.highPole`：預留本題顯示為 10 的概念端；省略等同固定方向的 `high`。尚未抽取反向題目，也尚未開放反向回答。
- 舊快照沒有新增欄位時繼續視為單端。雙端資料若缺少名稱或題目，讀取時拒絕，避免呈現方向不完整的問題。
- 定義查詢、週快照、增量與本機目錄合併保留雙端文字；無須調整 IndexedDB object store。

得分取勝／條件取勝的端點說明在建立合併資料時，直接從當時的兩筆 `attribute_translations` 複製原文，不重寫。這一步沒有修改任何作者文字或評分。

下一步才實作顯示與回存轉換，並將方向納入題目簽章、回答驗證、離線佇列與歷史紀錄。這些路徑全部接通前不可啟用雙端抽題。接著完成投票 UI、瀏覽 UI，最後套用已確認的五款校正和平均換算。

部署需先套用 migration 0083 再啟用讀取新欄位的程式；本步不執行正式環境 migration 或部署。
