# Workspace 備份的隨機故障模擬

`src/workspace/googleDriveBackup/simulation/` 以隨機產生的操作歷史檢查一件事：**不論網路、瀏覽器或其他裝置在何時出狀況，使用者的資料都不會被悄悄弄丟或被誤報為已備份。** 個案測試只能涵蓋想得到的情境；這裡交給程式去找想不到的順序。

## 執行的是什麼

真實程式：`useWorkspaceGoogleDriveBackup`（全部防護判斷）、`createGoogleDriveSnapshotBackup`、`GoogleDriveApi`、XLSX 編碼與解析、舊版 v2 還原。

模擬的邊界：

- Google Drive：既有的記憶體 fixture，外加一層故障注入。
- Google 登入：固定回傳權杖。
- IndexedDB：以記憶體中的 `WorkspaceData` 加上 `storageIdentity` 代表；`prepareBackup` 模仿正式來源「逐表即時讀取、`verify` 發現變更即中止」的行為。**`db.ts` 本身不在模擬範圍內。**
- 時間：假時鐘，30 分鐘的自動備份間隔會真的到期。

每段歷史由兩台（可調）裝置輪流操作，每一步是下列之一，並可附帶干擾：

| 步驟 | 內容 |
| --- | --- |
| 編輯 | 改儲存格、加列、加表、刪表、改名（含 Drive 不接受的字元與重複名稱） |
| 連結、立即備份、以本機覆蓋 | 對應備份視窗的按鈕 |
| 停留 N 分鐘 | 讓自動備份與背景清理自己發生 |
| 還原 | 選某個雲端版本，之後取代本機或取消 |
| 重新整理 | 記憶體狀態消失，localStorage 保留 |
| 清除網站資料 | IndexedDB 消失；localStorage 可能留著也可能一起消失 |
| 另一台裝置發布備份 | 獨立的真實備份服務，可以插在某個請求進行到一半時 |
| 使用者在 Drive 網頁丟棄備份 | 丟最新一份或整個「新版快照」資料夾 |

干擾：某個 Drive 請求沒送到、**已被 Drive 執行但回應遺失**、HTTP 500、HTTP 403；localStorage 寫入失敗；上傳途中使用者繼續編輯。故障可以指定第幾個請求，也可以指定角色（查詢最新版本、建立資料夾、上傳表格、發布索引、清理）。

每段歷史結束後網路恢復正常，每台裝置都必須能：連結 → 備份成功 → 重新整理後不被當成衝突 → 編輯後自動備份成功。

## 檢查的不變量

每一步之後都檢查；括號內是違反時回報的代碼。

- 發布的每份快照都能由獨立的服務還原，內容與上傳當下的本機資料完全相同（`SNAPSHOT_NOT_RESTORABLE`、`SNAPSHOT_CONTENT_MISMATCH`）；已上傳的檔案之後不被改寫（`PUBLISHED_FILE_MODIFIED`）。
- 沒有表格的裝置不上傳任何東西，連「以本機覆蓋」也不行（`UPLOAD_FROM_EMPTY_DEVICE`、`EMPTY_SNAPSHOT_PUBLISHED`）。
- 未經使用者明確覆蓋，不會蓋過裝置沒看過的雲端版本，也不會從換過 IndexedDB 的裝置上傳（`UPLOAD_OVER_UNSEEN_VERSION`、`UPLOAD_FROM_UNCONFIRMED_SOURCE`）。
- 只有備份動作會上傳；沒開自動備份就不會自動上傳（`UPLOAD_WITHOUT_REQUEST`、`AUTOMATIC_UPLOAD_WITHOUT_OPT_IN`）。
- 清理只丟最新三份以外、由 App 管理的快照資料夾；使用者自己的檔案與舊版備份不被更動（`TRASHED_RETAINED_VERSION`、`TRASHED_UNMANAGED_FILE`、`USER_OR_LEGACY_FILE_TOUCHED`）。
- 還原交付的就是所選版本，而且只交付一次（`RESTORE_CONTENT_MISMATCH`、`RESTORE_DELIVERED_TWICE`）。
- 本機備份紀錄只在真的發布之後才改變，並指向內容相符、仍在 Drive 上的備份（`RECORD_*`、`SUCCESS_WITHOUT_BACKUP`、`BACKUP_PUBLISHED_INTO_TRASH`）。
- 顯示「已備份」時，紀錄中的雲端版本內容就是畫面上的內容（`SAVED_STATUS_FOR_UNSAVED_DATA`）。
- 自己成功送出、上傳日誌仍在的備份不會被當成其他裝置的變更（`OWN_UPLOAD_REPORTED_AS_OTHER_DEVICE`）；蓋過這樣的版本也不算蓋過沒看過的版本。
- 每個動作都會結束，不會卡在忙碌狀態（`ACTION_NEVER_SETTLED`）。

「同時開始的兩個備份各自成為完整副本、後發布者成為最新」是 [snapshot-v3](snapshot-v3.md) 明載的取捨，不算違反：模擬只要求裝置依它**查詢當下**看到的最新版本做判斷。

## 目前的發現（2026-11-10）

第 2 項的代碼列在 `backupSimulation.test.tsx` 的 `KNOWN_FINDINGS`，隨機搜尋暫時略過它；第 2 至 4 項在 `knownFindings.test.tsx` 以最短步驟固定下來。修正後該測試會失敗，屆時把期望值改成沒有違反，並把代碼移出 `KNOWN_FINDINGS`。

1. **（已修正，2026-11-11）發布請求的回應遺失後，裝置被自己的備份擋住。** 索引已存進 Drive，瀏覽器卻沒收到回應（關分頁、斷線）。之後連結時顯示「已連結」，但每次備份都被拒絕並顯示「雲端備份已在其他裝置變更」，自動備份也停止，直到使用者按「以本機覆蓋」。原因：`snapshotJournal` 的待確認標記只用在連結時的判斷（`findRemoteFile`），`performBackup` 把未加標記的最新版本交給 `validateRemote` 並比對 `expectedRemoteFileId`。修正：`performBackup` 以同一份日誌辨認自己未確認的最新版本，不再把它當成衝突；日誌另外記住這份未確認的版本（`previous`），下一次嘗試失敗也不會忘記。IndexedDB 身分檢查不受影響。兩種情況仍會要求使用者確認，屬於正確的保守行為：日誌與備份紀錄都寫不進 localStorage 後又重新整理（裝置已無從得知那是自己的備份）；使用者在 Drive 丟掉最新一份後，露出的是較舊的版本。
2. **備份資料夾被丟進垃圾桶後，開著的頁面仍回報備份成功。** 服務在整個工作階段快取「新版快照」資料夾 ID。使用者在 Drive 網頁丟掉該資料夾後，同一個工作階段的下一次備份寫進已在垃圾桶的資料夾，畫面顯示「已備份到 Google Drive」、狀態為已備份；垃圾桶 30 天後清空。重新整理後會建立新的資料夾。**此項只在 fixture 上確認**：前提是真實 Drive 允許在垃圾桶內的資料夾建立檔案，需以真實 Google 帳號驗證。
3. **兩台裝置同時做第一次設定，會各自建立一套備份資料夾。** 雙方都查不到「動態表格備份」而各自建立，之後各自的快照只在自己的那一套裡看得到。只發生在完全沒有備份資料夾、且兩台裝置在同一兩秒內首次連結時。
4. **中斷的上傳留下的資料夾沒有人清。** 清理只處理有索引的快照；上傳到一半失敗時，已上傳的表格副本會一直留在 Drive 佔用空間（500 段歷史留下 151 個）。不影響資料安全。

## 模擬器自身的驗證

逐一暫時改壞正式程式的一道防護，確認隨機搜尋會回報對應代碼（改動未提交）：保留份數少一、上傳途中不做來源檢查、還原忽略所選版本、空白防護、雲端版本檢查、IndexedDB 身分檢查、索引放錯資料夾、自動備份忽略開關、已備份狀態忽略表格變更，共 9 種改法全部被抓到（空白防護、雲端版本檢查、自動備份開關各有兩層，這三種是兩層一起移除）。另有 4 道防護單獨移除時沒有被抓到，原因是另一層防護仍然擋住：服務層的空白檢查、hook 的版本檢查、hook 的自動備份開關（排程與執行各檢查一次）、清理時的根目錄判斷。前三者把兩層一起移除就會被抓到；最後一項因為索引清單已先排除根目錄下的檔案，沒有另外驗證。

## 使用方式

```powershell
# 一般測試會跑 30 段歷史（約 5 秒）
npx vitest run src/workspace/googleDriveBackup/simulation

# 加大搜尋：500 段、每段 40 步，約 90 秒
$env:BACKUP_SIM_SEEDS=500; npx vitest run src/workspace/googleDriveBackup/simulation

# 其他種子、三台裝置、較長的歷史
$env:BACKUP_SIM_SEED=1000; $env:BACKUP_SIM_DEVICES=3; $env:BACKUP_SIM_LENGTH=90

# 連已知發現一起回報
$env:BACKUP_SIM_STRICT=1
```

失敗時的訊息包含種子、違反的代碼、**自動縮減後的最短重現步驟**（中文敘述），以及同一份步驟的 JSON。把 JSON 放進 `BACKUP_SIM_STEPS` 可以只重播那段歷史；`BACKUP_SIM_LEGACY=1` 表示 Drive 上原有舊版 v2 備份，`BACKUP_SIM_FRESH=1` 表示完全沒有備份資料夾。`BACKUP_SIM_DEBUG=1` 會逐步印出執行的操作。

## 限制

- 這是模擬測試，不是真實 Google 或實體手機的驗收；Drive 的行為以 fixture 為準。
- 不包含 `db.ts`、跨分頁儲存衝突、匯入預覽的合併，以及真正同時掛載的兩個頁面（其他裝置以獨立的備份服務代表）。
- 隨機搜尋沒有找到違反，不代表不存在；它只說明這些種子涵蓋的歷史都成立。
