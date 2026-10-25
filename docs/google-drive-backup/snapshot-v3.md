# Workspace Drive 獨立快照

Workspace 以 IndexedDB 為主要來源。Google Drive 提供備份與還原，不做跨裝置儲存格同步或自動合併。備份由瀏覽器直接呼叫 Google Drive API，版本、提交與還原租約也存在使用者的 Drive，不依賴 D1、KV、Durable Objects 或網站登入。

## 儲存格式

```text
BoardGameHelper/動態表格備份/
├─ manifest.xlsx、舊版資料夾與表格（相容讀取）
└─ 新版快照/
   ├─ 紀錄-<operation UUID>.json
   ├─ 備份-<operation UUID>/
   │  ├─ manifest.xlsx
   │  ├─ 收藏.xlsx
   │  └─ 代購.xlsx
   └─ 還原-<lease UUID>.json（還原期間的暫存標記）
```

每次快照擁有全部表格，不引用其他快照的檔案。索引與 XLSX 保留原格式，邏輯資料夾、排序、底部導覽及欄位設定保存在檔案內，索引使用 `file_layout=flat`。下載快照資料夾為 ZIP 後可從本機匯入，不需要任何伺服器版本紀錄。

保留既有 backupKey `dynamic-sheet-primary-workspace-v3` 及根目錄，直接 Drive 紀錄與新資料夾標記 `schemaVersion=4`。JSON 紀錄放在快照資料夾外，不增加一般快照內的 XLSX 數量。它包含預留 ID、來源修訂摘要、父版本 ID、狀態與檔案簽章，不包含儲存格內容或 OAuth 憑證。

appProperties 只保存短小的識別、狀態、到期時間，不塞入檔案陣列或歷史 JSON。每組鍵＋值仍受 124 UTF-8 bytes 限制；需要清除舊屬性時必須遵循 Drive 的明確 null 語意，不能假設 PATCH 會整份取代屬性。JSON 紀錄以內容承載可變長度資料。

## 上傳與確認

1. 尋找並驗證 App 建立且帳號擁有的快照根資料夾。多個同時建立的根目錄一併讀取，不因同名就認領使用者資料夾。
2. 取得目前完整版本的圖與舊格式修改摘要，比對本機收據；有衝突時停止自動備份，保留明確確認入口。
3. 建立唯一 operation UUID，預留 JSON 紀錄、快照資料夾、索引及表格的 Drive IDs，先保存 uploading 紀錄。
4. 逐表讀取、編碼、上傳及釋放，不為備份額外組裝完整 Workspace。索引最後寫入，下載解碼並比對目錄、來源修訂及檔案對應。
5. 再次確認本機來源與雲端版本，驗證預定檔案的 ID、父層、型別、App 標記、大小、MD5 與修改時間。
6. 將該份 JSON 紀錄確認為 committed，確認沒有同時提交的分支，再保存本機收據。
7. 清理另行處理，不能讓清理失敗撤銷備份成功。

預留 ID 避免建立重試產生重複檔案；Drive 已有同 ID 時回傳 409，改讀取並驗證。每份最多 5,000 個 XLSX，這是表格數量限制，不是列數；預留 ID 分批申請。

Drive 版本圖沒有資料庫交易式的唯一提交者保證。兩台裝置同時完成時可能保留兩份分支；程式標示衝突並停止自動備份及清理，不覆寫其中任何一份。使用者明確確認後的新快照可承接當時看到的多個版本；上傳途中又有新變更仍會拒絕確認。不要以裝置時間或檔名排序冒充跨裝置鎖。

## 收據、中斷及資料遺失

本機收據保存 manifest ID／時間、結構及表格修訂，也綁定 IndexedDB `meta.storage.storageIdentity`。這個身分只在備份需要時建立，正常儲存、歷史保存及顯示區塊整理均保留，不讀取全部列，也不寫入匯出檔案。

沒有表格、身分不符或舊收據缺少身分時，暫停自動備份。連結發現空白時直接顯示「本機資料為空，已暫停自動備份。請先還原雲端備份。」，保留還原入口並隱藏上傳／覆蓋動作。關閉視窗、再連結、切換自動備份與恢復網路不能解除；非空來源需明確備份／覆蓋成功並保存新收據後才解除。匯入預覽未確認時同樣停止上傳。

來源沒有表格時，即使要求明確覆蓋也在任何備份寫入前拒絕。資料庫讀取失敗不轉成空白備份。首次開啟時若目錄 metadata 缺失但任一資料 store 有紀錄，保留原資料並回報完整性錯誤，不初始化或保存空白工作區。正常漸進載入仍依完整目錄讀取備份來源，不以記憶體裡已載入的表格張數決定內容。

IndexedDB 屬於網站資料；使用者清除網站資料可以移除它，持久儲存也無法防止主動清除。時間範圍清除不代表只刪除期間新增的表格列，也不能假設 IndexedDB 與 localStorage 必定一起消失。Chromium 分別使用 localStorage 修改時間及配額 bucket 修改時間篩選，見 [Chromium 清除實作](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/storage_partition_impl.cc#312)。隔離桌面 Chromium 148.0.7778.96 實測同一個 browsingData 請求可保留較舊 localStorage 並移除較新 IndexedDB；此為短時間邊界實驗，不是實體 Android 十五分鐘清除的驗收，不能據此確定個別事故原因。

pending journal 依已驗證的 Drive 根資料夾 ID 分區，只保存作業 UUID 與來源修訂摘要，不讀取或雜湊儲存格。提交回應遺失時先用原 UUID 查 Drive 收據，不直接再建立一份。成功保存本機收據後才清 journal；本機儲存失敗仍在當次記憶體確認收據，避免阻擋下一次修改。

上傳續期只更新到期時間 metadata，不重寫整份 JSON，避免延遲續期將 committed 改回 uploading。刪除以單向 `snapshotDeleting` metadata 標記，Drive PATCH 合併屬性時不會因延遲的內容更新而移除它。提交前重讀狀態，標記後不再接受提交或新還原。

## 還原與保留版本

還原固定選定 ID，先在 Drive 建立有到期時間的租約，再重讀提交狀態、完整下載並驗證表格，最後再次核對檔案簽章才交給合併／取代預覽。失敗或取消不改本機資料，finally 釋放租約；失聯租約到期後不再阻擋清理。

正常保留最近三份完整新版快照。分支、有效上傳及還原租約會暫停清理，暫停期間可能多於三份。清理先排除保留版本、驗證簽章、標記 deleting，再檢查租約，只移除仍在原資料夾的已知 App 檔案，每次最多二十個。未知檔案、移出的檔案及資料夾外殼都保留，不以 drive.file 的可見清單推斷資料夾沒有其他內容，也不清空垃圾桶。已過期上傳經一天緩衝後可回收已知檔案。

放棄的中斷作業保留精簡 ID 紀錄作為 tombstone，不再當成備份版本；後續若仍有已送出的檔案晚到，維護會重新辨識並回收，不因先前清理完成而留下無法追蹤的檔案。

查詢雲端版本不附帶清理。來源待確認時不安排維護；正常成功後另行清理，頁面在線且授權有效時每五分鐘重試。還原租約與刪除標記是 Drive 上的協調機制，不應宣稱具備 D1 交易的強一致性；衝突處理以保留可還原副本為優先。

## 舊版與後端移除

v1／v2 保留相容讀取，不寫入、搬動或清理舊檔。既有沒有 Drive JSON 紀錄的 v3 資料夾，必須有完整可解碼索引、非空表格對應及正確的檔案 metadata 才納入歷史；只有 manifest 或部分上傳不會當成有效版本。這些舊 v3 快照只讀，不自動清理。schemaVersion=4 資料夾遺失紀錄時不冒充舊備份。

整個 Workspace 路由、其中的所有專案、啟動、共用模組、設定、授權及背景工作均不使用 D1。Worker 已移除備份授權驗證、版本、提交、租約與清理的 D1 程式。除了公開設定的 GET／HEAD，其餘 `/api/workspace` 命名空間（包括舊備份 API、未知路徑與其他 HTTP 方法）均在任何資料庫及 session middleware 前回傳 410，不將 Google 權杖當作網站 session。

使用者已明確要求清除全部 Workspace D1 紀錄。歷史 migration 0115 保留供遷移追蹤，0116 移除三張 `drive_backup_*` 資料表、資料、索引及兩個發布 trigger，不移除其他網站資料或 Google Drive 檔案。發布流程先部署不依賴 D1 的程式並通過正式站檢查，才套用 0116；直接執行遠端 migration 也須先確認正式站已停用 Workspace D1 API，避免舊版仍使用資料表時先刪資料。0116 不與其他待套用 migration 混合發布。

公開 `/api/workspace-config` 只提供 Google OAuth Client ID，在任何 DB/session middleware 前回應，前端使用 credentials:omit，不帶網站登入或 Google 權杖。備份本體與提交紀錄不經網站後端。維持既有 GIS `openid drive.file` scope；不呼叫 tokeninfo，不依賴 sub 或網站帳號來補出授權未保證的欄位。

權杖只在頁面記憶體，直接交給 Google API，不存於瀏覽器儲存、Drive JSON 或本站後端；不保存 refresh token。重新開頁仍需要使用者授權，未新增後端持續授權或自動登入功能。主動斷線後不能自行重連。

## UI、進度與驗證

維持既有精簡介面，不新增手動驗證或技術診斷設定。全流程同一條 0–100% 進度，依實際階段與表格步驟估計工作量，不是位元組或剩餘時間。成功前最高 99%，Drive 提交及本機收據成功後顯示 100% 並立即解除忙碌，不等待清理。

測試以實際前端 GIS 設定及請求呼叫直接 Drive fixture，涵蓋續傳、回應遺失、分支、保留三份、租約、檔案異動、XLSX 讀寫及空資料保護，並拒絕任何應用程式備份 API 請求。設定測試以實際前端 loader 呼叫實際 Worker 公開設定 route，缺少 D1、帶有舊 session 時仍能工作。401 只換發一次，403 不反覆開 OAuth，拒絕後仍可手動重試。

`check-workspace-boundary.mjs` 納入測試、型別檢查及建置，掃描整個 Workspace 與啟動模組，追蹤共用模組、重新匯出及動態 import，拒絕網站 session／資料 API／Worker 資料層依賴。`tests/core/workspace-no-database.spec.ts` 以舊網站 session cookie 開啟 Workspace，完成編輯、搜尋、設定、Drive 備份與重開；除公開 Client ID 外不得發出任何本站 API 請求。清除 migration 在含既有紀錄與外鍵的 SQLite 及完整新 schema 上驗證，必須移除所有 Workspace 物件且保留其他網站資料。

`tests/core/workspace-backup-safety.spec.ts` 以隔離 IndexedDB、直接 Drive fixture 與手機原生觸控驗證清空資料的提醒；設定保留／一起清除都不得上傳。畫面可操作後首次觸控立即且只生效一次，不用等待或重試掩蓋漏點。模擬測試、正式站健康檢查與真實 Google／實體手機驗收分開回報，fixture 不代表真實第三方驗收。

可執行 `node --expose-gc --import tsx scripts/benchmark-drive-snapshots.ts` 量測 500、2,000、10,000 列的合成 XLSX 編碼；不連網或讀使用者資料。桌面結果不能當手機完整備份速度。

網路請求量以 `snapshotNetwork.test.ts` 回歸：兩表、三份舊 v3 快照、十個舊版空資料夾的同一案例，原實作含維護共 249 次 Drive 請求、27 次舊索引下載；改為精簡發現、單筆作業直接讀取及舊索引快取後，約 65 次請求、3 次舊索引下載，空目錄不逐個查詢。這是合成案例的請求量，不是手機耗時量測。

根目錄與索引探索只讀所需 metadata；舊 XLSX 索引依 modifiedTime、MD5、大小快取已解碼內容，資料夾及檔案 metadata 仍重新驗證。查詢／續期單筆作業只讀其已知 Drive ID，保留根目錄擁有權、作業識別、刪除標記及晚到上傳檢查。建立、提交前後的版本圖檢查與實際備份內容驗證不省略；沒有新增後端或持久憑證。
