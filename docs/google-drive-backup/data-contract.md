# Google Drive 備份資料與程式檔案規劃

## 本機備份狀態

建議將備份連結資訊與 workspace 資料分開保存。workspace 本身仍由現有 IndexedDB 管理；備份 metadata 可放在同一個 local database 的獨立 key/store。

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

`driveAccountHint` 只保存顯示用的遮罩資訊，不保存 access token 或 refresh token。

## 雲端檔案識別

第一版每個連結只維護一個 Drive file ID。建立檔案時寫入：

```json
{
  "name": "玩錯動態表格-備份.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "appProperties": {
    "workspaceFormat": "dynamic-sheet-v1",
    "schemaVersion": "1",
    "checksum": "sha256:...",
    "exportedAt": "2026-08-15T00:00:00.000Z"
  }
}
```

更新既有備份使用該 `fileId`，不因每次備份都建立新檔案。未來若要版本保留，再另外增加 retention 設定，不要一開始就讓 Drive 裡產生大量檔案。

## 預計程式分層

```text
src/workspace/backup/
  types.ts                 # 前端狀態與 UI 所需型別
  backupState.ts           # 本機 backup metadata
  backupState.test.ts
  googleDriveClient.ts     # 只處理前端授權回呼與 API client 邊界

worker/routes/
  google-drive.ts          # OAuth callback、連結狀態、備份／還原 endpoint

worker/data/
  googleDriveConnections.ts # 使用者與 refresh token 的加密保存

migrations/
  xxxx_google_drive_connections.sql
```

真正開始實作時，需先確認 Worker 是否能安全保存加密 refresh token，以及 OAuth redirect URI／production origin 的設定方式；在此之前不應新增半成品 token table。

## 版本與相容性

- 雲端備份檔明確標記 `dynamic-sheet-v1`。
- 還原一律經過現有 `importWorkspaceXlsx()`，沿用目前的格式版本檢查。
- 未來格式升級時，解析器先判斷版本，再明確拒絕未知格式或執行受測試覆蓋的 migration。
- checksum 只用來判斷是否有差異，不取代格式版本，也不作為安全驗證。
