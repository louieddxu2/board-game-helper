# Workspace 備份測試清理（2026-10-26）

範圍：以已發布的直接 Drive 實作為基準，清除舊 coordinator／網站 session 假設，修復本輪發現的資料安全退步。Workspace 的執行路徑、設定、授權及備份不使用 D1；歷史資料移除與零 D1 守門測試保留。

## 檔案審查

| 檔案 | 嚴重度 | 結果 |
| --- | --- | --- |
| `snapshotBackup.ts` | 高 | 補回索引發布前的來源與版本核對、發布後分支確認，移除無用 coordinator 參數與修訂雜湊。 |
| `snapshotStorage.ts` | 高 | 限定根目錄與擁有權、核對還原 ID、修正三份保留邊界，只清理已知檔案；選定還原另由服務重查位置與修改時間。 |
| `snapshotLightweightBackup.test.ts` | 高 | 修正請求名稱與實際計數；補來源變更、雲端變更、分支、還原錯配及三份保留的失敗案例。 |
| `tests/core/workspace-backup-safety.spec.ts` | 高 | 用目前的服務建立 fixture，實際清除 IndexedDB，涵蓋 localStorage 保留／清除；不建立舊 JSON 收據。 |
| `tests/workspace-startup/backup-progress.spec.ts` | 中 | 確認階段改攔截現行索引 metadata 查詢，失敗時保留舊本機紀錄。 |
| `tests/workspace-startup/backup-restore.spec.ts` | 中 | 保留手機三份版本、預覽與還原到 IndexedDB 的整段驗證。 |
| `tests/workspace-startup/driveSupport.ts` | 高 | 拒絕 `/api/session` 與其他網站 API；資料準備改用無應用程式的空白同源頁。 |
| `scripts/run-core-e2e.mjs` | 中 | 發布 E2E 同時執行手機備份進度／還原，修正原先漏跑的原因。 |
| `scripts/core-release-gate.test.ts` | 中 | 驗證這兩份手機 E2E 確實接入發布 runner。 |
| `scripts/check-workspace-boundary.test.mjs` | 中 | 保留跨模組 D1/session 禁令，增加 KV／Durable Objects 與絕對網站 API URL 的拒絕案例。 |
| `backupDataLoss.test.tsx` | 低 | 保留來源身分、空白資料、自動備份與重連防護；不宣稱取代瀏覽器資料清除 E2E。 |
| `useWorkspaceGoogleDriveBackup.test.tsx` | 低 | 保留明確覆蓋與已選版本參數的契約測試，舊 Drive 參數另由服務層真正核對。 |
| `googleDriveConnection.test.ts` | 低 | 已改為 GIS 直接連線 Drive，沒有失效 coordinator 匯入。 |
| `workspaceAuthorization.integration.test.tsx` | 低 | 保留真實前端授權設定、401／403／重試與禁止應用程式後端請求的契約。 |
| `workspaceConfig.test.ts` | 低 | 保留實際前端 loader 連接實際 Worker 公開設定的驗證。 |
| `worker/retired-backup-routes.test.ts` | 低 | 保留：驗證舊 API 回傳 410 且不進入 DB/session middleware。 |
| `scripts/workspace-d1-removal.test.mjs` | 低 | 保留：只在隔離 SQLite 驗證舊資料消失且其他網站資料保留。 |
| `scripts/workspace-d1-release.test.mjs` | 低 | 保留：防止其他環境尚用舊版時先刪除歷史資料表。 |
| `tests/core/workspace-no-database.spec.ts` | 低 | 保留：整段手機操作只能取得公開 Client ID，不請求網站資料。 |
| `backupOperation.test.ts` | 低 | 舊版直接 Drive 相容模組的作業標記測試，不是 D1 coordinator。 |
| `backupRetention.test.ts` | 低 | 舊版共用 XLSX 相容模組，與目前的新快照清理分開。 |
| `backupRetentionLegacy.test.ts` | 低 | 保留舊格式 ancestry 與 Drive 屬性限制驗證。 |
| `folderRestore.test.ts` | 低 | 保留 v1／v2 舊備份還原及錯誤對應驗證。 |

## 可讀性

請求預算名稱與斷言對齊，區分連結查找、完整備份及維護；不把先後操作的過期版本測試稱為真正同時提交測試。

## 可靠性

以受控請求與原生觸控同步，不加 sleep 或重試掩蓋失敗。清空資料測試不進入會取得網站 session 的其他頁面。

## 診斷

網站 API 違規立即顯示實際請求路徑；錯誤案例確認沒有發布索引、沒有寫入雲端或沒有改寫舊本機紀錄。

## 設計

只模擬 Google／網路邊界；瀏覽器 E2E 執行實際備份服務、IndexedDB 與匯入預覽。舊 JSON coordinator fixture 不再是必要條件。

## AI 測試風險

原先綠燈未涵蓋另一個 Playwright 設定中的手機備份測試。發布 runner 已納入它們；新增反向案例限制實作，不能只測成功路徑。本輪未引入 mutation runner，也不宣稱取得 mutation score。

## 覆蓋與驗證範圍

包含完整 Vitest、型別／行數／零 D1 邊界檢查、core E2E 與手機進度／還原 E2E。合成 fixture 的請求預算包含版本確認；不代表真實 Google、實體 Android 或網路耗時驗收。

本輪結果：207 個 Vitest 檔案／1,453 項通過；core 13 項及手機備份 4 項 E2E 通過；型別與邊界檢查通過，最大維護檔案 582 行。
