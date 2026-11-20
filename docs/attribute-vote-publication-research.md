# 單次屬性投票讀寫研究

研究日期：2026-11-19。已提交的功能基準為 `45662e9`，包含 `73a2d43` 的先收票、單一計分者及每日補算。
研究開始時工作目錄乾淨；路由、migration 0127、冪等收票、計分進度與每日恢復入口均已核對。
`7036521` 已完成索引精簡、同交易分數差額及 metadata 發布保護的正式整合。
本頁保留當時的量測；後續完整 API 優化見 [完整請求成本](attribute-request-cost.md)。

## 可重現量測

執行 `node scripts/research-attribute-publication.mjs`；也可在後面指定 `pair-serial`、`ranking-serial` 等情境。
使用獨立的 Miniflare D1 與完整 migration，建立四種隔離資料庫：

- `current`：以 Git 讀取 `45662e9` 的功能基準。
- `lean`：只在本機移除三個舊索引。
- `inline`：實際工作目錄的正式差額發布程式，保留舊索引以便單獨比較。
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

在 `7036521` 整合時使用正式 Worker 執行全部 24 組比較，結果與上表一致；目前重新執行腳本會反映後續程式改進。
這是本機 fixture 的結果；角色、遊戲組合、既有分數與併發時序會影響實際列數。

## 方向一：移除不再使用的變動欄位索引

目前抽題、參考遊戲與排序均在前端處理，現行 Worker 已沒有依 `question_slot`、RD 或分數範圍抽題的查詢。
以下索引仍會隨每次更新分數／RD 維護：

- `idx_attribute_score_states_question_slot`
- `idx_attribute_score_states_question_slot_global`
- `idx_attribute_score_states_attribute_score`

migration `0128_remove_obsolete_attribute_score_indexes.sql` 僅移除這三個索引，保留欄位、主鍵與 `idx_attribute_score_states_random`。
後者以 attribute_id 起首，與以 subject_id 起首的主鍵分別覆蓋兩個外鍵，避免刪除父資料時退回全表掃描。
量測內分數與計數完全相同，`foreign_key_check(attribute_score_states)` 也沒有違規。
單次六款排序平均少 18 列寫入；此方向可以獨立實作，不需要改投票格式或發布協定。

## 方向二：在計分交易內發布既有分數差額

目前計分後會排入整款遊戲的 subject bundle，發布時再讀名稱、組合、所有屬性值等資料。
例如逐筆六款排序的十次送出，原本目錄階段就讀 1,950 列、寫 250 列。

正式流程直接使用計分時已產生的 `stateToMatrixValue`，建立現行讀取端已有的扁平 `kind: value` 增量：

1. 在同一 D1 batch 內暫時使用既有 rebuild flag，略過分數的整包目錄 outbox。
2. 保存分數、更新目錄版本並寫入 value entries。
3. 清除 flag、更新計分進度並釋放租約。

上述步驟同交易提交，原始收票仍在前一筆獨立交易保存。
不用重新查詢 subject bundle，也不用維護／刪除每個分數的發布 outbox；保留的 metadata 更新仍使用原有流程。
格式直接沿用既有 JS formatter，沒有在 SQL 另做一套浮點捨入或計分規則。

## 已整合的發布順序保護

不能只把 value entries 寫進去就完成：既有 subject bundle 會替換該遊戲整組分數。
若它先讀到舊分數、稍後才以較新的目錄版本發布，就可能蓋過剛發布的 value delta。

`attributeCatalogPublication.ts` 的 metadata 發布因此在同一交易核對：

- 讀取 bundle 前的目錄版本仍相同。
- 當時的 snapshot generation 仍相同；完整歷史重算可能換快照而不增加 delta clock。
- 對應 outbox revision 仍相同。

驗證後才原子保留版本、寫入 bundle 並確認 outbox。過期發布整筆回復，工作保留供重新讀取與發布。
這套防護已接進正式的 `flushCatalogOutbox`，適用於 subject、definition 與 candidate。
衝突回傳未處理，保留 outbox 供後續 flush 重新讀取；其他資料庫錯誤仍回報失敗。

## 已驗證的研究契約

- 四個版本每款遊戲的分數、RD、直接評分與比較計數精確一致。
- 所有十張票均已保存且算完，含十萬筆歷史及不同遊戲的併發情境。
- 使用實際後端增量解析器及前端 `applyAttributeCatalogChanges`，確認新分數可讀取，別名、BGG ID 與組合 metadata 保留。
- 故意讓目錄寫入失敗：分數、進度、目錄版本全部回復，rebuild flag 不殘留，原始票仍保存。
- 移除故障後，雲端處理者可自行補算並發布正確差額。
- 新分數先發布時，過期 bundle 被拒絕，outbox 保留，重新讀取後可正確發布。
- 完整重算更換 generation、delta clock 未變時，同樣拒絕過期 bundle；從新 snapshot 繼續套用增量仍正確。
- 實際 metadata publisher 的 revision 變動、另一個 publisher 搶先完成、entry 寫入失敗均不會發布舊資料或提前確認工作。
- 新增遊戲、停用屬性與刪除 subject，從既有快取分頁讀取後仍正確加入／移除資料。

上述量測與故障注入是本機 D1 及既有解析／快取函式的驗證，不代表正式站已更新。

## 維護與回歸

`scripts/attribute-catalog-publication.test.ts` 驗證正式發布與實際前後端快取契約；
`scripts/attribute-online-scoring.test.ts` 驗證單一計分者、冪等收票、有限批次與每日恢復。
比較腳本不再注入另一套原型，直接編譯正式程式，原先的 `attributePublicationPrototype.ts` 已刪除。
維持立即收票與原有計分觸發方式，不新增十五分鐘排程。

整合驗證：`npm test` 1,690 項通過、1 項既有略過；`npm run typecheck`、`npm run check:d1-fanout` 通過。
本機正式前端／Worker／D1 的手機投票、排序、回應遺失後重試、十人併發及觸控回歸共 14 項通過。
