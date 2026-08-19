# Google Drive 備份資料與程式檔案規劃

## 本機備份狀態

備份連結資訊與 workspace 資料分開保存。workspace 本身仍由現有 IndexedDB 管理；目前備份 metadata 以獨立 localStorage key 保存，僅包含檔案識別與時間，不包含 access token。

```ts
interface WorkspaceBackupState {
  provider: 'google-drive';
  status: 'disconnected' | 'ready' | 'dirty' | 'uploading' | 'offline' | 'error';
  manifestFileId: string | null;
  tableCount: number;
  folderCount: number;
  lastBackupAt: number | null;
  lastBackupChecksum: string | null;
  localChecksum: string | null;
  schemaVersion: 1;
  updatedAt: number;
}
```

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
}
```

不保存 access token、refresh token、帳號識別資訊或 workspace 內容。`dirty` 狀態由目前 workspace 的 `updatedAt` 與上次備份的 `sourceUpdatedAt` 比較而來。

## 雲端檔案識別

每個連結維護一個 manifest file ID，以及每個資料夾／表格的 Drive file ID。建立 manifest 時寫入：

```json
{
  "name": "manifest.json",
  "mimeType": "application/json",
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

## 目前程式分層

```text
src/workspace/googleDriveBackup/
  types.ts                         # Drive、GIS 與備份服務的邊界型別
  googleIdentityTokenProvider.ts  # 瀏覽器端 GIS token provider，token 僅在記憶體
  googleDriveApi.ts                # Drive v3 查找、資料夾與 multipart 上傳／下載
  singleFileBackup.ts              # 舊版單一 XLSX 備份的相容還原 facade
  folderBackup.ts                  # manifest + 目錄資料夾 + 逐表 JSON 備份／還原
  useWorkspaceGoogleDriveBackup.ts # folder manifest 備份、舊 XLSX 相容還原與預覽整合
  GoogleDriveBackupDialog.tsx      # 目錄入口開啟的自訂彈窗

src/pages/WorkspacePage.tsx        # 只在 Drawer 放置備份入口
```

Google Drive 備份不新增 Worker route 或 refresh token table；Google client ID 沿用既有 `/api/session` 提供的公開設定，Drive API 由瀏覽器直接呼叫。遊戲頁的外部資源是獨立的 D1 migration，不與 Drive 備份資料混在一起。

如果未來要支援排程備份或背景同步，才需要另開一版設計，重新確認 Worker 保存 refresh token 的安全邊界與 OAuth redirect URI；不能把那套責任混進目前的前端手動備份。

## 版本與相容性

- 雲端 manifest 與表格檔各自明確標記 format 與 version。
- 新版資料夾備份會驗證 manifest 和每張表格 JSON；舊版單一 XLSX 還原仍經過現有 `importWorkspaceXlsx()`。
- 未來格式升級時，解析器先判斷版本，再明確拒絕未知格式或執行受測試覆蓋的 migration。
- checksum 只用來判斷是否有差異，不取代格式版本，也不作為安全驗證。
