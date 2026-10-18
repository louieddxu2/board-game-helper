# Workspace 備份 v3

Workspace 仍以 IndexedDB 為主要來源。Google Drive 提供備份與還原，不做跨裝置儲存格同步或自動合併。新寫入使用 `dynamic-sheet-primary-workspace-v3`，與 v1 單檔及 v2 共享檔案格式隔離。

## 獨立快照

```text
BoardGameHelper/動態表格備份/
├─ manifest.xlsx、舊版資料夾與表格（相容讀取）
└─ 新版快照/
   ├─ 備份-<operation UUID>/
   │  ├─ manifest.xlsx
   │  ├─ 收藏.xlsx
   │  └─ 代購.xlsx
   └─ 備份-<另一個 operation UUID>/...
```

每次快照擁有全部表格，不引用其他快照的檔案。實體檔案採單層配置；邏輯資料夾、排序、底部導覽與欄位設定保存在索引和 XLSX。索引沿用原格式，增加選用 `file_layout=flat`；檔名清理不安全字元，避免同名及 manifest.xlsx 碰撞。

本機原有 ZIP 匯出不變。下載一份 Drive 快照資料夾為 ZIP 後，也能透過本機匯入還原；匯入不依賴後端版本紀錄，不需要原 Drive IDs 仍有效。

appProperties 只存固定短標記：backupKey、backupKind、snapshotId、localId、schemaVersion、workspaceFormat。不再保存父版本陣列或歷史 JSON，仍驗證 124 UTF-8 bytes（鍵＋值）及每個 App 30 組 private properties 上限。

## 上傳與發布

1. 以已驗證 Drive 帳號取得正式修訂號；帳號與根資料夾由後端綁定。
2. 建立唯一 operation UUID，預留快照資料夾、索引及表格的 Drive IDs。
3. 逐表讀取、編碼 XLSX、上傳並釋放，不為備份額外組裝完整 Workspace。
4. 最後寫入索引，下載解碼並比對目錄、修訂與表格對應，再確認本機來源仍有效。
5. Worker 驗證所有預定檔案的 ID、父層、型別、App 標記、大小、Drive MD5 與修改時間。
6. D1 單一條件更新同時提交收據與 head；Google Drive 上傳不在 D1 交易內。
7. 清理過期快照另行處理，不能改變目前修訂或撤銷成功。

兩台裝置從同一修訂開始，只能一台提交成功。明確覆蓋只確認已看到的差異，仍會拒絕上傳期間發生的新提交或舊客戶端寫入。

預留 ID 可避免建立重試產生重複檔案；Drive 對已成功建立的 ID 回傳 409。單次快照基本寫入為「表格數＋2」，另加預留 ID、metadata 查詢、驗證及後端呼叫。超過 1,000 個預留 ID 會分批申請。協定上限為每份 5,000 個檔案，限制是表格數量，不是列數。

## 收據與斷線恢復

本機原有備份紀錄保存 manifest ID／時間及結構、表格修訂，判定待備份變更；table file ID 不再供下一份重用。

pending journal 依已驗證 Drive 帳號雜湊分區，只存作業 UUID 與來源修訂摘要。摘要使用既有修訂標記和目錄 metadata，不讀取或雜湊儲存格。

提交回應遺失時，先以原 UUID 查成功收據；不直接建立另一份。只有本機收據確認保存後才清持久 journal。Storage 寫入失敗時保留重載恢復資訊；當次記憶體中仍會確認收據，避免阻擋後續新變更。其他裝置已有後續版本時，不會拿舊收據掩蓋衝突。

## 授權與 API

沿用 GIS `drive.file`，不要求先登入網站。Drive token 在頁面記憶體，也會於備份 API 請求期間短暫交給 Worker，以驗證身分及操作 Drive metadata。token 不寫入 D1、localStorage、IndexedDB、URL 或日誌，不保存 refresh token。

Worker 使用 Google 官方 OAuth2Client.getTokenInfo 同樣的 POST＋Authorization Bearer 協定，驗證 aud、azp（存在時）、sub、drive.file scope 和期限。僅快取 token 雜湊及已驗證身分，最多一分鐘、有界 128 項，不保留原 token。驗證失效、限流或後端不可用時延後備份，不推測成功。

備份 API 位於 `/api/workspace-backup/`，不使用網站 session，也不觸發遊戲規則 catalog outbox；保留 Origin、限流、16 KiB body 限制及 no-store。錯誤只回固定代碼，不回傳 Google 診斷內容。

| 端點 | 用途 |
|---|---|
| GET state | 帳號、綁定 root、目前修訂、最多三份版本摘要及舊版變更狀態 |
| POST begin | 建立候選並預留 Drive IDs |
| GET operations/:id | 讀取自己的作業／收據 |
| POST operations/:id/renew | 延長有效候選租約 |
| POST operations/:id/commit | 驗證並原子提交 |
| POST operations/:id/restore | acquire／verify／release 還原租約 |
| POST cleanup | 有限處理一份已取得清理資格的快照 |

state 只投影版本摘要，不傳回全部表格 ID 或 inventory；選定還原／續傳時才讀完整 operation。

## D1 狀態與清理

Migration 0115 新增獨立資料表，不改 Workspace IndexedDB：

- drive_backup_sets：帳號、綁定 root、修訂、head、已確認的舊版基準。
- drive_backup_operations：來源修訂、預留 ID、狀態、期限、成功收據、檔案簽章及清理重試狀態。
- drive_backup_restore_leases：還原中的快照及期限。

D1 不保存表格內容、名稱或 OAuth token。inventory 只有 ID、大小、Drive MD5 和修改時間。

uploading → committed 的 BEFORE trigger 檢查預期修訂；AFTER trigger 更新 head。兩者在同一 statement 的交易內成功或回滾。已進入 deleting／deleted 的作業不可重播成可用備份。

正常保留最近三次正式修訂。清理的條件更新排除 head、保留版本、有效候選和還原租約；取得資格後改成 deleting，不能再開始新還原。清理失敗留待重試，不造成版本衝突；已清理收據三十天後淘汰。

候選有效期一小時，在需要時續期。中斷候選須過期並經過一天緩衝才回收。Google 垃圾桶不會由程式清空。

`drive.file` 不能保證列出手動加入資料夾的所有檔案。整夾清理需將自動建立的快照資料夾明確定義為備份專用；若要保護任意手動加入內容，必須只清理已知檔案，不能把 API 可見清單當成完整清單。

部署預設只清理仍位於過期快照內的已知檔案，保留資料夾外殼與其他內容。每個請求最多移除二十個檔案，後續接續處理；頁面開啟、在線且授權仍有效時，每五分鐘背景重試，不等待下一次資料變更。正式備份完成不等待清理網路請求。

確認採用備份專用資料夾政策後，可設定 Worker 變數 `GOOGLE_DRIVE_SNAPSHOT_FOLDER_CLEANUP=enabled`，改為每份一次整夾移入垃圾桶。測試明確覆蓋兩種政策。切換政策不會追溯刪除已留下的資料夾外殼。

## 還原與遷移

線上清單以後端正式版本為準，不把候選或不明資料夾推測成最新版。還原固定選定 ID，完整下載並驗證所有表格，結束前再檢查檔案簽章，才交給既有合併／取代預覽。失敗或取消不改本機資料。

v1／v2 保留相容讀取，新版不呼叫其 backup／retention 寫入流程，也不清理或搬動舊檔。遷移期可能有三份新版及額外舊備份；舊檔清理需另行確認所有裝置已更新。選單以短標籤「舊備份」區分。

後端以 v1／v2 檔案 ID 和修改時間的摘要偵測舊客戶端寫入。它只負責遷移保護，不用來判定 v3 正式版本。新版自己的清理不修改舊檔，因此不會因刪除歷史產生假分支。

## UI 與執行範圍

維持既有備份／還原入口，只顯示必要進度、完成或需確認版本。驗證自動執行，不新增驗證按鈕、版本圖、checksum 或診斷設定。

有變更且到期時建立完整快照，成功後一併更新所有表格的備份修訂與時間。自動備份和清理只在頁面／PWA 開啟、在線且已授權時運作；不把 Worker cron 當成持有長期 Drive 權杖的排程服務。使用者主動斷線後不能自行重連。

## 驗證與效能

測試涵蓋真實 SQLite migration、競爭提交、收據重試、保留三份、還原租約、授權錯誤、檔案異動和 XLSX 完整流程。模擬 API 不代替正式 OAuth／Drive 隔離目錄驗收。

執行 `node --expose-gc --import tsx scripts/benchmark-drive-snapshots.ts` 可量測 500、2,000、10,000 列的合成單表編碼，不連網或讀使用者資料。桌面結果不能當成手機速度或完整備份時間；完整上傳增加傳輸量。若成為瓶頸，再評估將未變更表格複製為獨立檔案，保持快照互不引用。
