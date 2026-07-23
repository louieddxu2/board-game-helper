# 校稿交換流程

正式內容永遠以 D1 為準。匯出檔是可丟棄的交換檔；匯入只建立提案，不會直接改寫規則。

## 1. 限定匯出範圍

編輯者在 `/review` 可組合以下條件：

- 遊戲
- 流程階段
- Tag
- 最後更新日期
- 僅缺少來源
- 最多 50、100、250 或 500 筆

Worker 只查詢符合條件的已發布規則。這是一次明確的編輯操作，不會在背景重複下載。

## 2. 選擇格式

### CSV

適合 Excel、LibreOffice 或 Google Sheets。每列是一條規則：

- `current_`：匯出當下的正式內容，請勿修改。
- `proposed_`：校稿後的建議內容。
- `action`：`unchanged`、`propose` 或 `hide`。
- `reason`：修改理由。
- `rule_id`、`base_updated_at`、`base_content_hash`：衝突偵測資料，請勿修改。

要提出修改，編輯 `proposed_` 欄位並把 `action` 改成 `propose`。要建議隱藏內容，將 `action` 改成 `hide`。CSV 使用 UTF-8 BOM，Excel 可直接辨識中文。

### JSON

適合 AI 或程式批次處理。只應修改每個 item 的 `proposed`、`reason` 與 `action`；`current`、`target` 與 `base` 都是受保護的參考資料。

交給 AI 時可使用：

> 檢查此檔案中的桌遊規則。不要改動 target、base 或 current。只修改 proposed，填寫 reason，確定要提出的項目才把 action 改成 propose；不確定時維持 unchanged。不要捏造來源。

## 3. 匯入

同一份檔案重複匯入時，系統利用完整檔案雜湊重用既有批次，不重複建立提案。

匯入時會：

1. 驗證格式與欄位。
2. 忽略 `unchanged` 和沒有實際差異的項目。
3. 重新讀取 D1 中的目前內容。
4. 比對 `base_updated_at` 和 `base_content_hash`。
5. 建立 `pending` 或 `conflict` 的逐筆提案。

因此即使校稿期間正式資料已被其他人修改，舊檔也不會無聲覆蓋新內容。

## 4. 人工審核

校稿佇列同時顯示目前內容與建議內容。編輯者可以：

- 在核准前再次修改建議文字。
- 逐筆標記採用或退回。
- 一次提交最多 50 個決定。
- 依批次和狀態篩選。

採用時才寫入正式規則，並建立 `rule_revisions` 修訂紀錄。隱藏也是軟刪除。

## 5. 多人與零散校稿

- `review_batches` 表示一份匯入檔或一輪 AI 校稿。
- `review_proposals` 是可以獨立處理的最小單位。
- `batch_id` 可以為空，因此網站內的一條零散建議也能進入同一佇列。
- 提案具有 `version`、`claimed_by`、`claimed_until` 與基準版本，可支援未來多人領取及避免舊畫面覆蓋。

校稿頁只取得目前篩選下的少量提案；核准時只傳送被勾選的提案，不上傳整個資料庫。
