# 單次屬性投票讀寫研究

研究日期：2026-11-19。已提交的功能基準為 `45662e9`，包含 `73a2d43` 的先收票、單一計分者及每日補算。
研究開始時工作目錄乾淨；路由、migration 0127、冪等收票、計分進度與每日恢復入口均已核對。
本研究只新增 scripts 與文件，沒有改動正式 Worker、前端或 migration，也沒有部署。

## 可重現量測

執行 `node scripts/research-attribute-publication.mjs`；也可在後面指定 `pair-serial`、`ranking-serial` 等情境。
使用獨立的 Miniflare D1 與完整 migration，建立四種隔離資料庫：

- `current`：已提交的功能基準。
- `lean`：只在本機移除三個舊索引。
- `inline`：只在本機編譯的 Worker 中注入同交易分數差額發布。
- `inline_lean`：合併上述兩個方向。

量測包含收票、計分、索引／trigger 與目錄發布；不含共用 session middleware、既有目錄首次下載及驗證查詢。
每個情境十次送出；下表除以十，表示平均每按一次送出。六款排序整組算一次，不是五次送出。

| 投票方式 | 已提交版本 | 只移除舊索引 | 只改差額發布 | 兩者合併 |
| --- | --- | --- | --- | --- |
| 兩兩比較 | 135.4 讀／28.4 寫 | 135.4／22.4 | 58.4／24.4 | 58.4／18.4 |
| 兩兩比較含直接評分 | 136.4／29.4 | 136.4／23.4 | 59.4／25.4 | 59.4／19.4 |
| 六款排序，逐次送出 | 311.2／69.2 | 311.2／51.2 | 127.2／53.2 | 127.2／35.2 |
| 相同六款，十人同時 | 79.0／10.7 | 79.0／8.9 | 60.6／9.1 | 60.6／7.3 |
| 不同六款，十人同時 | 267.0／75.5 | 267.0／57.5 | 98.4／57.7 | 98.4／39.7 |
| 十萬筆歷史，相同六款同時 | 79.0／10.7 | 79.0／8.9 | 60.6／9.1 | 60.6／7.3 |

這是本機 fixture 的結果；角色、遊戲組合、既有分數與併發時序會影響實際列數。

## 方向一：移除不再使用的變動欄位索引

目前抽題、參考遊戲與排序均在前端處理，現行 Worker 已沒有依 `question_slot`、RD 或分數範圍抽題的查詢。
以下索引仍會隨每次更新分數／RD 維護：

- `idx_attribute_score_states_question_slot`
- `idx_attribute_score_states_question_slot_global`
- `idx_attribute_score_states_attribute_score`

本機原型僅移除這三個索引，保留欄位、主鍵與 `idx_attribute_score_states_random`。
後者以 attribute_id 起首，與以 subject_id 起首的主鍵分別覆蓋兩個外鍵，避免刪除父資料時退回全表掃描。
量測內分數與計數完全相同，`foreign_key_check(attribute_score_states)` 也沒有違規。
單次六款排序平均少 18 列寫入；此方向可以獨立實作，不需要改投票格式或發布協定。

## 方向二：在計分交易內發布既有分數差額

目前計分後會排入整款遊戲的 subject bundle，發布時再讀名稱、組合、所有屬性值等資料。
例如逐筆六款排序的十次送出，原本目錄階段就讀 1,950 列、寫 250 列。

原型直接使用計分時已產生的 `stateToMatrixValue`，建立現行讀取端已有的扁平 `kind: value` 增量：

1. 在同一 D1 batch 內暫時使用既有 rebuild flag，略過分數的整包目錄 outbox。
2. 保存分數、更新目錄版本並寫入 value entries。
3. 清除 flag、更新計分進度並釋放租約。

上述步驟同交易提交，原始收票仍在前一筆獨立交易保存。
不用重新查詢 subject bundle，也不用維護／刪除每個分數的發布 outbox；保留的 metadata 更新仍使用原有流程。
格式直接沿用既有 JS formatter，沒有在 SQL 另做一套浮點捨入或計分規則。

## 正式整合前必須一起處理的發布順序

不能只把 value entries 寫進去就完成：既有 subject bundle 會替換該遊戲整組分數。
若它先讀到舊分數、稍後才以較新的目錄版本發布，就可能蓋過剛發布的 value delta。

研究中的 metadata 發布原型因此在同一交易核對：

- 讀取 bundle 前的目錄版本仍相同。
- 當時的 snapshot generation 仍相同；完整歷史重算可能換快照而不增加 delta clock。
- 對應 outbox revision 仍相同。

驗證後才原子保留版本、寫入 bundle 並確認 outbox。過期發布整筆回復，工作保留供重新讀取與發布。
這套防護目前只存在研究原型，尚未接進正式的 `flushCatalogOutbox`。

## 已驗證的研究契約

- 四個版本每款遊戲的分數、RD、直接評分與比較計數精確一致。
- 所有十張票均已保存且算完，含十萬筆歷史及不同遊戲的併發情境。
- 使用實際後端增量解析器及前端 `applyAttributeCatalogChanges`，確認新分數可讀取，別名、BGG ID 與組合 metadata 保留。
- 故意讓目錄寫入失敗：分數、進度、目錄版本全部回復，rebuild flag 不殘留，原始票仍保存。
- 移除故障後，雲端處理者可自行補算並發布正確差額。
- 新分數先發布時，過期 bundle 被拒絕，outbox 保留，重新讀取後可正確發布。
- 完整重算更換 generation、delta clock 未變時，同樣拒絕過期 bundle；從新 snapshot 繼續套用增量仍正確。

這些是本機 D1 原型及既有解析／快取函式的驗證，不是正式站或瀏覽器端的完整驗收。

## 建議實作順序

先將索引精簡做成獨立 migration，驗證查詢及完整發布測試。
再將差額發布與 metadata 的版本／generation／revision 防護一起整合，涵蓋新增遊戲、刪除屬性、歷史重算與多裝置快取恢復。
不要將沒有 metadata 發布防護的原型直接套入正式程式。
