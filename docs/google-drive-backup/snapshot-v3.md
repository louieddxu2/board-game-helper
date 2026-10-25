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

1. 找到 App 的備份根目錄，以兩次 metadata 查詢讀取其快照資料夾及索引；不下載歷史 XLSX。
2. 比對本機備份紀錄中的 manifest ID、修改時間與 IndexedDB 身分；不符時暫停自動上傳。
3. 建立新快照資料夾，逐表讀取、編碼及上傳，釋放暫存內容。索引最後上傳。
4. 最後一張表上傳後再確認本機來源及雲端版本；有變更就不發布索引。
5. 索引保存前一版本 ID。上傳後再查版本，發現獨立分支就保留副本、回報衝突並停止清理。
6. 保存本機備份紀錄後才顯示 100%。歷史清理在背景進行，不撤銷已成功的備份。

Drive 不提供這套流程的跨裝置原子鎖。兩台裝置完全同時發布時可能短暫各自看到成功，後續查詢會偵測分支並暫停自動備份；不宣稱提供交易式同步或自動合併。明確覆蓋可承接已看到的分支，仍須通過最後的版本核對。

appProperties 只保存短識別與版本關係；每組鍵值遵守 124 UTF-8 bytes，較長的父版本清單沿用分段編碼。不以裝置時間取代版本關係。

## 本機資料遺失防護

本機備份紀錄與 IndexedDB `storageIdentity` 綁定。沒有表格、身分不符、讀取失敗或還原預覽尚未確認時停止上傳；空表格目錄即使明確覆蓋也不得備份。正常漸進載入依完整目錄逐表讀取，不把尚未載入記憶體的表格當成不存在。

連結時發現空白，顯示「本機資料為空，已暫停自動備份。請先還原雲端備份。」，隱藏上傳動作並保留還原。關閉、重新連結、切換自動備份或恢復網路均不能解除。非空來源需使用者明確確認並成功備份後才建立新的本機紀錄。

清除網站資料可能移除 IndexedDB，也不能假設 localStorage 一定同時消失。本機讀取失敗不初始化成空白資料；目錄 metadata 遺失但仍有表格資料時保留原資料並回報完整性問題。

本機 pending journal 僅保存 Drive 根目錄與上傳 UUID，協助辨識尚未保存本機紀錄的上傳；不包含儲存格、內容指紋或雲端 coordinator 狀態。

## 還原與清理

還原固定使用選定的 manifest ID，下載前重新核對它仍在原 App 根目錄、由帳號擁有且修改時間未變，再檢查非空目錄、唯一表格引用與每張 XLSX 內的表格 ID。任何一張失敗都不交付匯入預覽。下載成功後仍由使用者選擇合併或取代，取消不改 IndexedDB。

新版正常保留三份。剛好三份時背景維護不刪除任何版本；分支存在時停止清理。只清理有新版修訂標記的快照，不回收舊 coordinator 格式的快照。

清理先核對 App 擁有的原始快照資料夾、索引引用及檔案 metadata；已移動、修改或對應不明的檔案保留。只把已知索引及表格移到垃圾桶，不刪整個資料夾、不碰使用者另外加入或 drive.file 看不到的檔案、不清空垃圾桶。清理中斷或下載中的舊版本被回收時，還原可失敗重試，但不改本機資料。

## 授權與零 D1 邊界

公開 `/api/workspace-config` 只回傳 OAuth Client ID，在任何 DB/session middleware 前回應；前端使用 `credentials: 'omit'`。其他 `/api/workspace*` API 在資料庫及網站 session middleware 前回傳 410。Google token 只存在頁面記憶體並送往 Google，不呼叫 tokeninfo、不依賴 sub、不保存 refresh token。主動斷線後需使用者重新連結。

歷史 migration 0115／0116 保留遷移追蹤；0116 已移除 Workspace 舊資料表與紀錄。移除測試只驗證舊資料確實消失及其他網站資料保留，不是 Workspace 的資料存取功能。

## 測試與請求預算

`snapshotLightweightBackup.test.ts` 檢查直接 Drive 請求：已有根目錄、兩張表、無重試時，查找 2 次，完整備份 10 次（上傳前、索引前及上傳後各兩次 metadata 查詢，加資料夾與三個 XLSX）；加上回收一份舊快照的情境不超過 20 次。首次建立目錄、分頁、授權刷新、失敗重試與異常歷史另計。這是合成請求量，不是手機耗時。

`tests/core/workspace-backup-safety.spec.ts` 透過目前的備份服務建立雲端資料，再實際清除瀏覽器 IndexedDB；分別驗證保留／清除 localStorage 後，連結、首次觸控與 31 分鐘排程都不會上傳空白資料。hook 單元測試不能取代這段 E2E。

`tests/core/workspace-no-database.spec.ts` 驗證啟動、編輯、搜尋、設定、備份與重開只請求公開 Client ID。Drive 共用 fixture 對其他網站 API 立即失敗。設定測試以實際前端 loader 連接實際 Worker route；401、403、拒絕及重試邊界另有授權契約測試。

發布檢查同時執行 core E2E 與手機備份進度／還原 E2E。`check-workspace-boundary.mjs` 追蹤 Workspace、啟動與共用模組，禁止 D1、KV、Durable Objects、網站 session 及資料 API；納入測試、型別與建置流程。

模擬測試、正式站健康檢查與真實 Google／實體手機驗收須分開回報。合成 XLSX 編碼可執行 `node --expose-gc --import tsx scripts/benchmark-drive-snapshots.ts`；不連網、不讀使用者資料，桌面結果不代表手機完整備份速度。
