# Workspace Drive 獨立快照

Workspace 的資料只儲存在本機 IndexedDB；選用的備份與還原由瀏覽器直接呼叫 Google Drive。整個 Workspace 不使用 D1、網站 session、KV、Durable Objects 或伺服器保存的 Google 憑證。

## 檔案與上傳

```text
BoardGameHelper/動態表格備份/
├─ 舊版 manifest.xlsx 與表格（相容讀取）
└─ 新版快照/
   └─ 備份-<UUID>/
      ├─ manifest.xlsx
      ├─ 收藏.xlsx
      └─ 代購.xlsx
```

每份快照擁有全部表格，不共用其他版本的 XLSX。保留 `dynamic-sheet-primary-workspace-v3` 與現有 XLSX 格式；`file_layout=flat` 的索引保存目錄樹、排序、底部導覽與表格 ID。新備份不建立 JSON 收據、租約、預留 ID 或後端作業紀錄。舊 JSON 紀錄不再參與判斷，也不自動刪除。

1. 找到 App 的備份根目錄，以一次 metadata 查詢讀取索引；不下載歷史 XLSX。
2. 比對本機備份紀錄中的 manifest ID、修改時間與 IndexedDB 身分；不符時暫停自動上傳。
3. 建立新快照資料夾，逐表讀取、編碼及上傳，釋放暫存內容。索引最後上傳。
4. 最後一張表上傳後再確認本機來源；有變更就不發布索引。本機來源檢查不呼叫 Drive。
5. 以 manifest 上傳的成功回應確認完成，不再增加索引上傳前後的雲端查詢。畫面的來源檢查共用服務的同一次查找結果。
6. 保存本機備份紀錄後才顯示 100%。歷史清理在背景進行，不撤銷已成功的備份。

Drive 不提供這套流程的跨裝置原子鎖。上傳前核對已選版本；同時開始的備份各自建立唯一資料夾與完整副本，不修改另一份快照。這是備份，不提供交易式同步、分支協調或自動合併；後續查找按版本與時間選擇最新索引。

appProperties 只保存短識別、修訂與時間；每組鍵值遵守 124 UTF-8 bytes。新索引以 `snapshotRoot` 記錄 App 管理的備份根目錄，不新增父版本圖或雲端 JSON 狀態。

## 本機資料遺失防護

本機備份紀錄與 IndexedDB `storageIdentity` 綁定。沒有表格、身分不符、讀取失敗或還原預覽尚未確認時停止上傳；空表格目錄即使明確覆蓋也不得備份。正常漸進載入依完整目錄逐表讀取，不把尚未載入記憶體的表格當成不存在。

連結時發現空白，顯示「本機資料為空，已暫停自動備份。請先還原雲端備份。」，隱藏上傳動作並保留還原。關閉、重新連結、切換自動備份或恢復網路均不能解除。非空來源需使用者明確確認並成功備份後才建立新的本機紀錄。

清除網站資料可能移除 IndexedDB，也不能假設 localStorage 一定同時消失。本機讀取失敗不初始化成空白資料；目錄 metadata 遺失但仍有表格資料時保留原資料並回報完整性問題。

本機 pending journal 僅保存 Drive 根目錄與上傳 UUID，協助辨識尚未保存本機紀錄的上傳；不包含儲存格、內容指紋或雲端 coordinator 狀態。

## 還原與清理

還原固定使用選定的 manifest ID，下載前重新核對它仍在原 App 根目錄、由帳號擁有且修改時間未變，再檢查非空目錄、唯一表格引用與每張 XLSX 內的表格 ID。任何一張失敗都不交付匯入預覽。下載成功後仍由使用者選擇合併或取代，取消不改 IndexedDB。

新版正常保留三份。剛好三份時背景維護不刪除任何版本。只清理明確標有 `snapshotRoot`、修訂及 App 身分的新版備份；舊格式保留相容讀取，不以額外歷史掃描認領並清理。

新備份成功後，使用已取得的索引 metadata，對每個超額版本的獨立子資料夾呼叫一次 `trashed=true`；不重新下載索引、不列舉逐個子檔、不清空垃圾桶，也永遠不清理備份根目錄。失敗時保留舊版本供後續重試。

使用者已明確同意：過期備份子資料夾視為 App 管理範圍，手動放進去的檔案也可能一起進入垃圾桶。`drive.file` 不應被宣稱為防止連帶移動子檔的保證；Google 明載檔案可能繼承父資料夾的垃圾桶狀態，見 [Files resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)。下載中的舊版本若被回收，還原可失敗重試，但不改本機資料。

## 授權與零 D1 邊界

公開 `/api/workspace-config` 只回傳 OAuth Client ID，在任何 DB/session middleware 前回應；前端使用 `credentials: 'omit'`。其他 `/api/workspace*` API 在資料庫及網站 session middleware 前回傳 410。Google token 只存在頁面記憶體並送往 Google，不呼叫 tokeninfo、不依賴 sub、不保存 refresh token。主動斷線後需使用者重新連結。

歷史 migration 0115／0116 保留遷移追蹤；0116 已移除 Workspace 舊資料表與紀錄。移除測試只驗證舊資料確實消失及其他網站資料保留，不是 Workspace 的資料存取功能。

## 測試與請求預算

`snapshotLightweightBackup.test.ts` 固定兩表完整備份為 5 次：查找 1 次、建立單次備份資料夾 1 次、上傳兩表 2 次、最後上傳 manifest 1 次。單獨查找為 1 次，沒有重複計入畫面備份。需要回收一份舊備份時另加 1 次，共 6 次；沒有歷史 XLSX 下載。首次連結／建立目錄、Drive 分頁、授權刷新及失敗重試另計。

`tests/workspace-startup/backup-restore.spec.ts` 從原生點擊到完成計數實際前端對 Drive fixture 的全部 API 呼叫，連續驗證正常兩表備份 5 次，以及含背景清理的 6 次；不是只量服務函式。fixture 驗證呼叫結構，不代表真實 Google／實體手機耗時驗收。

`tests/core/workspace-backup-safety.spec.ts` 透過目前的備份服務建立雲端資料，再實際清除瀏覽器 IndexedDB；分別驗證保留／清除 localStorage 後，連結、首次觸控與 31 分鐘排程都不會上傳空白資料。hook 單元測試不能取代這段 E2E。

`tests/core/workspace-no-database.spec.ts` 驗證啟動、編輯、搜尋、設定、備份與重開只請求公開 Client ID。Drive 共用 fixture 對其他網站 API 立即失敗。設定測試以實際前端 loader 連接實際 Worker route；401、403、拒絕及重試邊界另有授權契約測試。

發布檢查同時執行 core E2E 與手機備份進度／還原 E2E。`check-workspace-boundary.mjs` 追蹤 Workspace、啟動與共用模組，禁止 D1、KV、Durable Objects、網站 session 及資料 API；納入測試、型別與建置流程。

模擬測試、正式站健康檢查與真實 Google／實體手機驗收須分開回報。合成 XLSX 編碼可執行 `node --expose-gc --import tsx scripts/benchmark-drive-snapshots.ts`；不連網、不讀使用者資料，桌面結果不代表手機完整備份速度。
