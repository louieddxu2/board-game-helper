# Google Drive 備份資料與程式檔案規劃

## 本機備份狀態

備份連結資訊與 workspace 資料分開保存。workspace 本身仍由現有 IndexedDB 管理；目前備份 metadata 以獨立 localStorage key 保存，僅包含檔案識別與時間，不包含 access token。

```ts
interface WorkspaceBackupState {
  provider: 'google-drive';
  status: 'disconnected' | 'ready' | 'dirty' | 'uploading' | 'offline' | 'error';
  driveFileId: string | null;
  driveAccountHint: string | null;
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
}
```

不保存 access token、refresh token、帳號識別資訊或 workspace 內容。`dirty` 狀態由目前 workspace 的 `updatedAt` 與上次備份的 `sourceUpdatedAt` 比較而來。

## 雲端檔案識別

第一版每個連結只維護一個 Drive file ID。建立檔案時寫入：

```json
{
  "name": "玩錯動態表格-備份.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "appProperties": {
    "backupKey": "dynamic-sheet-primary-workspace-v1",
    "workspaceFormat": "dynamic-sheet-v1",
    "schemaVersion": "1",
    "exportedAt": "2026-08-15T00:00:00.000Z",
    "backedUpAt": "1765766400000",
    "sourceUpdatedAt": "1765766400000"
  }
}
```

更新既有備份使用該 `fileId`，不因每次備份都建立新檔案。未來若要版本保留，再另外增加 retention 設定，不要一開始就讓 Drive 裡產生大量檔案。

## 目前程式分層

```text
src/workspace/googleDriveBackup/
  types.ts                         # Drive、GIS 與備份服務的邊界型別
  googleIdentityTokenProvider.ts  # 瀏覽器端 GIS token provider，token 僅在記憶體
  googleDriveApi.ts                # Drive v3 查找、資料夾與 multipart 上傳／下載
  singleFileBackup.ts              # 固定 backupKey 的單檔 upsert／restore facade
  useWorkspaceGoogleDriveBackup.ts # workspace XLSX 序列化與還原預覽整合
  GoogleDriveBackupDialog.tsx      # 目錄入口開啟的自訂彈窗

src/pages/WorkspacePage.tsx        # 只在 Drawer 放置備份入口
```

目前不新增 Worker route、refresh token table 或 D1 migration。Google client ID 沿用既有 `/api/session` 提供的公開設定，Drive API 由瀏覽器直接呼叫。

如果未來要支援排程備份或背景同步，才需要另開一版設計，重新確認 Worker 保存 refresh token 的安全邊界與 OAuth redirect URI；不能把那套責任混進目前的前端手動備份。

## 版本與相容性

- 雲端備份檔明確標記 `dynamic-sheet-v1`。
- 還原一律經過現有 `importWorkspaceXlsx()`，沿用目前的格式版本檢查。
- 未來格式升級時，解析器先判斷版本，再明確拒絕未知格式或執行受測試覆蓋的 migration。
- checksum 只用來判斷是否有差異，不取代格式版本，也不作為安全驗證。
