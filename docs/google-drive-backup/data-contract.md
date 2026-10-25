# Google Drive v1／v2 歷史資料契約

本文記錄 v1／v2 歷史契約。新版寫入以 [v3 獨立快照契約](snapshot-v3.md) 為準；舊格式僅供相容還原，不由新版清理器刪除。

## 本機備份狀態

備份連結資訊與 workspace 資料分開保存。workspace 本身仍由現有 IndexedDB 管理；備份 metadata 以獨立 localStorage key 保存，包含檔案識別、時間與小型修訂標記，不包含 access token 或表格內容。

以下為舊版資料形狀；現行紀錄另含 IndexedDB `storageIdentity`，以新版契約為準：

```ts
interface WorkspaceDriveBackupRecord {
  fileId: string | null;
  fileName: string | null;
  lastBackupAt: number | null;
  sourceUpdatedAt: number | null;
  remoteModifiedTime: string | null;
  tableCount: number;
  folderCount: number;
  structureRevision: string | null;
  tableBackups: Record<string, {
    lastBackupAt: number;
    sourceUpdatedAt: number;
    changeRevision?: string;
    driveFileId: string | null;
  }>;
}
```

`dirty` 狀態比較表格的 `changeRevision` 與結構的 `structureRevision`，不掃描儲存格、不計算內容指紋。一般提交、復原／重做與匯入會為變更的表格產生新標記；資料夾、目前表格及底部導覽列變更則更新結構標記。修改後再復原仍視為待備份變更。`updatedAt` 保留時間用途，IndexedDB 的 `storageRevision` 保留跨分頁衝突檢查用途。

舊資料未包含標記時，暫以既有更新時間作為相容標記；第一次本機修改會開始保存新的修訂標記。舊備份紀錄與 manifest 的指紋欄位會被忽略，新紀錄不再寫入。XLSX 與 ZIP 保存選用修訂欄位；索引與一般表格維持 v1，包含自動計算公式的表格設定頁使用 v2。

手動完整備份重新上傳全部表格；自動備份上傳到期的變更表格，每張表格仍最多 30 分鐘一次。未選中的表格沿用已發布的檔案識別，最後上傳新的 manifest 發布備份。若 manifest 上傳失敗，先前發布的備份仍可還原。雲端檔案版本與分支衝突檢查獨立於修訂標記。

## 雲端檔案識別

每個連結維護一個 manifest file ID，以及每個資料夾／表格的 Drive file ID。建立 manifest 時寫入：

```json
{
  "name": "manifest.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "appProperties": {
    "backupKey": "dynamic-sheet-primary-workspace-v2",
    "backupKind": "manifest",
    "workspaceFormat": "dynamic-sheet-v1",
    "schemaVersion": "1",
    "exportedAt": "2026-08-15T00:00:00.000Z",
    "backedUpAt": "1765766400000",
    "sourceUpdatedAt": "1765766400000"
  }
}
```

表格檔使用 `backupKind=table`、`localId=表格 ID`，資料夾使用 `backupKind=folder`、`localId=資料夾 ID`。資料夾可更新 parent 與 name；表格與索引採新檔發布，避免中斷時破壞已完成的版本。索引的 `parentManifestIds` 保存前一版本 ID，供版本排序與分支衝突檢查使用。

## 保留與清理

Workspace 設定保留最新 3 個可還原版本。這是 3 份索引及其需要的所有表格檔，並非最多 3 個實體檔案。版本優先依發布 ancestry 排序；舊索引缺少 ancestry 時，才以備份時間補足。

確認新索引已成為唯一最新版本後，讀取保留的索引、收集共用表格 ID。先把超出的舊索引移到垃圾桶，再清理沒有被保留版本引用的表格，包括中斷上傳留下的孤立檔案。共用表格仍保留。清理只讀檔案 metadata 與最多 3 份小型索引，不下載表格內容，也不額外載入本機所有列。

清理只處理對應 backupKey、位於該備份根目錄或其 App 標記子資料夾的檔案。不刪除其他根目錄、未標記檔案、舊版單一 XLSX，也不移除空資料夾，以免影響使用者自行加入的內容。檔案只移到 Google Drive 垃圾桶，不永久刪除。

備份與還原在讀取索引前，先建立 `backupKind=operation` 的暫時作業標記。完成後移到垃圾桶；殘留標記於 1 小時後到期。時間以 Drive 回應或建立時間校準，避免裝置時鐘偏差。發布索引與完成還原前確認作業仍有效，失效作業必須重新執行。

每次清理前重新檢查版本與作業狀態。若有分支、新版本、保留索引已變更或另一個有效作業，就延後清理；清理失敗也不撤銷已完成的新備份。UI 顯示警告，後續成功備份再重試，所以異常期間可能暫時多於 3 個版本。升級後第一次成功備份才會開始整理既有歷史檔案。

## 還原驗證

使用者選定索引後，還原必須使用該 ID，不重新挑選最新版本。若所選索引已不存在或修改時間改變，要求重新選擇。索引的表格節點、表格引用與 XLSX 內的表格 ID 必須對應，所有表格驗證成功後才交給既有匯入預覽。由使用者選擇合併、取代或取消，下載不直接改寫本機資料。

## 本機 ZIP 匯出

本機「匯出全部資料」使用與雲端相同的資料夾式檔案結構，但以 ZIP 打包：

```text
BoardGameHelper-動態表格備份.zip
└─ BoardGameHelper/動態表格備份/
   ├─ manifest.xlsx
   ├─ 資料夾/表格.xlsx
   └─ 其他表格.xlsx
```

`manifest.xlsx` 使用 v1 索引格式；表格 XLSX 依是否包含自動計算使用 v1 或 v2 設定頁。本機 ZIP 的 manifest 保留本機 ID 與階層，不寫入 Google Drive file ID。整個資料庫匯入支援這種 ZIP，也保留單一 Workspace `.xlsx` 的相容讀取路徑。

## 舊版相容模組

```text
src/workspace/googleDriveBackup/
  types.ts                         # Drive、GIS 與備份服務的邊界型別
  googleIdentityTokenProvider.ts  # 瀏覽器端 GIS token provider，token 僅在記憶體
  googleDriveApi.ts                # Drive v3 查找、資料夾與 multipart 上傳／下載
  singleFileBackup.ts              # 舊版單一 XLSX 備份的相容還原 facade
  folderBackup.ts                  # manifest 試算表 + 目錄資料夾 + 逐表 XLSX 備份／還原
  manifestHistory.ts               # 版本 ancestry、分支與保留版本選取
  backupOperation.ts               # 有期限的作業標記與有效性檢查
  backupRetention.ts               # 保留索引、共用表格保護與垃圾桶清理
  useWorkspaceGoogleDriveBackup.ts # folder manifest 備份、舊 XLSX 相容還原與預覽整合
  GoogleDriveBackupDialog.tsx      # 目錄入口開啟的自訂彈窗

src/pages/WorkspacePage.tsx        # 只在 Drawer 放置備份入口
```

舊版曾從 `/api/session` 取得公開 Client ID，此路徑已停用。現行 Workspace 只從不存取資料庫／session 的 `/api/workspace-config` 取得公開設定，Drive API 由瀏覽器直接呼叫。

整個 Workspace 不使用 D1、KV、Durable Objects、網站 session 或伺服器持有的 Google 憑證；本文件的歷史作業標記不適用於目前的新備份流程。

## 版本與相容性

- 雲端 manifest 與表格檔各自明確標記 format 與 version。
- 新版資料夾備份會驗證 manifest 試算表和每張表格 XLSX；每張表格沿用現有設定頁格式，還原仍經過 `importWorkspaceXlsx()`。
- 未來格式升級時，解析器先判斷版本，再明確拒絕未知格式或執行受測試覆蓋的 migration。
- 是否需要備份使用修訂標記；格式與表格 ID 驗證不依賴內容指紋。
