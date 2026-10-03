# Google Drive 備份資料與程式檔案規劃

## 本機備份狀態

備份連結資訊與 workspace 資料分開保存。workspace 本身仍由現有 IndexedDB 管理；備份 metadata 以獨立 localStorage key 保存，包含檔案識別、時間與小型修訂標記，不包含 access token 或表格內容。

目前實作的最小資料形狀是：

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

舊資料未包含標記時，暫以既有更新時間作為相容標記；第一次本機修改會開始保存新的修訂標記。舊備份紀錄與 manifest 的指紋欄位會被忽略，新紀錄不再寫入。表格 XLSX、Workspace XLSX 與 ZIP 保存選用修訂欄位，格式版本維持 v1。

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

表格檔使用 `backupKind=table`、`localId=表格 ID`，資料夾使用 `backupKind=folder`、`localId=資料夾 ID`。移動時更新 parent，重新命名時更新 name；刪除時只會將先前由本 App 標記的對應項目移到垃圾桶。

## 本機 ZIP 匯出

本機「匯出全部資料」使用與雲端相同的資料夾式檔案結構，但以 ZIP 打包：

```text
BoardGameHelper-動態表格備份.zip
└─ BoardGameHelper/動態表格備份/
   ├─ manifest.xlsx
   ├─ 資料夾/表格.xlsx
   └─ 其他表格.xlsx
```

`manifest.xlsx` 與每張表格的 XLSX 都沿用同一套 v1 試算表格式；本機 ZIP 的 manifest 會保留本機 ID 與階層，但不寫入 Google Drive file ID。整個資料庫匯入支援這種 ZIP，也保留單一 Workspace `.xlsx` 的相容讀取路徑。

## 目前程式分層

```text
src/workspace/googleDriveBackup/
  types.ts                         # Drive、GIS 與備份服務的邊界型別
  googleIdentityTokenProvider.ts  # 瀏覽器端 GIS token provider，token 僅在記憶體
  googleDriveApi.ts                # Drive v3 查找、資料夾與 multipart 上傳／下載
  singleFileBackup.ts              # 舊版單一 XLSX 備份的相容還原 facade
  folderBackup.ts                  # manifest 試算表 + 目錄資料夾 + 逐表 XLSX 備份／還原
  useWorkspaceGoogleDriveBackup.ts # folder manifest 備份、舊 XLSX 相容還原與預覽整合
  GoogleDriveBackupDialog.tsx      # 目錄入口開啟的自訂彈窗

src/pages/WorkspacePage.tsx        # 只在 Drawer 放置備份入口
```

Google Drive 備份不新增 Worker route 或 refresh token table；Google client ID 沿用既有 `/api/session` 提供的公開設定，Drive API 由瀏覽器直接呼叫。遊戲頁的外部資源是獨立的 D1 migration，不與 Drive 備份資料混在一起。

如果未來要支援排程備份或背景同步，才需要另開一版設計，重新確認 Worker 保存 refresh token 的安全邊界與 OAuth redirect URI；不能把那套責任混進目前的前端手動備份。

## 版本與相容性

- 雲端 manifest 與表格檔各自明確標記 format 與 version。
- 新版資料夾備份會驗證 manifest 試算表和每張表格 XLSX；每張表格沿用現有設定頁格式，還原仍經過 `importWorkspaceXlsx()`。
- 未來格式升級時，解析器先判斷版本，再明確拒絕未知格式或執行受測試覆蓋的 migration。
- checksum 只用來判斷是否有差異，不取代格式版本，也不作為安全驗證。
