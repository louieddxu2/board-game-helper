# Google Drive 備份研究與規劃

## 目前結論

動態表格目前應維持「本機資料為主」：IndexedDB 是即時使用的資料來源，Google Drive 只提供備份與還原，不先做多裝置即時同步或自動合併。

目前的完整匯出格式已經可以作為備份檔：整個資料庫匯出為一個 `.xlsx`，包含 Workspace 目錄、每張表的資料頁與獨立設定頁。備份功能應直接重用 `src/workspace/spreadsheet.ts` 的 `exportWorkspaceXlsx()`／`importWorkspaceXlsx()`，避免另做一套可能不一致的格式。

## Google 授權方向

目前網站的 Google 登入只驗證使用者身分，並不代表已取得 Google Drive 操作權限。Drive 備份需要另外走 Google Identity Services 的 OAuth 授權流程。

目前依照 `C:\architecture-kits\kits\google-drive-single-file-backup` 採用瀏覽器端 Google Identity Services token flow：

1. 使用者只在 workspace 的目錄彈窗中按下「Google Drive 備份」。
2. 前端以既有的 Google OAuth Web Client ID，向 Google 申請 `drive.file` access token。
3. access token 僅保存在當次頁面工作階段的記憶體，不寫入 localStorage、IndexedDB、URL 或 Worker。
4. 前端直接呼叫 Drive v3，建立／更新一個固定備份檔，或下載該檔案後交給既有 XLSX 匯入預覽。

這和現有 Google 登入保持分離：網站登入只驗證使用者身分，Drive 授權只在使用者主動開啟備份功能時發生。重新整理頁面後不保留 token；GIS 可能依使用者既有同意狀態再次快速授權，但不能把它視為本機保存了長期憑證。

若未來需要無人值守的排程備份、多裝置背景同步，才另行評估 authorization code flow、refresh token 加密保存與 Worker 端 API；那會是不同的安全與資料責任範圍，不屬於目前第一版。

官方文件：

- [Google Identity Services：Web 上的 OAuth 2.0](https://developers.google.com/identity/oauth2/web/guides/overview)
- [Google Drive API：選擇授權 scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## Scope 選擇

### 建議第一版：`drive.file`

備份檔是使用者看得見、也能自行管理的 `.xlsx`。第一版建議使用 `drive.file`，只讓 App 建立或修改自己建立的檔案，不掃描使用者整個 Drive。這個 scope 較窄，也符合目前「一個本地資料庫對應一個備份檔」的需求。

不需要 Google Sheets API，也不應把 XLSX 轉成 Google 試算表；目前的設定頁、欄位屬性與 v1 相容性都由既有 XLSX 格式負責。

### 可選方向：`drive.appdata`

如果未來明確希望備份檔完全隱藏、不讓使用者在 Drive 介面中管理，可以改用 `appDataFolder`。它只供 App 存取，檔案不會顯示在一般 Drive 介面；這比較適合內部設定，不一定適合使用者想自行下載、保留或手動還原的備份。

官方文件：[Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)

## 第一版資料流

```text
本機編輯
   ↓
IndexedDB 儲存
   ↓
標記「有未備份變更」
   ↓ 使用者在目錄彈窗按下立即備份
產生目前完整 XLSX
   ↓
瀏覽器直接呼叫 Drive files.create / files.update
   ↓
保存 fileId、備份時間與格式版本（不保存 access token）
```

還原則反向執行，但在真正覆蓋本機資料前，必須先經過自訂衝突確認介面。第一版不做單格合併：選擇「保留本機」、「使用雲端」或「取消」。

上傳檔案可先採用單次 multipart upload；若未來備份檔變大或需要顯示進度，再改用 resumable upload。Drive API 官方說明：[Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)。

## 建議的備份檔

- 顯示名稱：`玩錯動態表格-備份.xlsx`
- MIME type：`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- 內容：目前完整 Workspace XLSX，不另建第二種資料格式
- `appProperties`：`backupKey`、`workspaceFormat`、`schemaVersion`、`exportedAt`、`backedUpAt`、`sourceUpdatedAt`
- 本機保存：Drive `fileId`、最後備份 checksum、最後備份時間、目前是否 dirty

`appProperties` 可讓 App 在不掃描整個 Drive 的情況下找回自己的備份檔。Drive API 支援使用 `appProperties` 搜尋檔案：[Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files)。

## PWA 與離線行為

- 離線時仍可照常編輯本機資料。
- 沒有網路時，備份按鈕顯示離線狀態，不能假裝已完成。
- 恢復連線後仍由使用者手動按下備份；目前不偷偷執行背景上傳。
- 還原屬於高風險動作，不應在背景自動執行。
- Service Worker 不需要保存 Google token，也不應代替 OAuth 流程。

## 目前不做的事情

- 不把 Google Drive 當成即時資料庫。
- 不在伺服器保存 access token、refresh token 或使用者的整份 workspace 內容。
- 不掃描或列出使用者整個 Drive。
- 不自動合併兩台裝置的格子變更。
- 不把資料轉成 Google Sheets 原生格式。

## 第一版已決定的範圍

1. 備份檔讓使用者在 Drive 中看得到，使用 `drive.file`。
2. 只提供使用者主動觸發的備份與還原，不做自動背景備份。
3. Drive 上只維護一個目前備份檔，靠 `appProperties.backupKey` 找回並更新，不每次建立新檔。
4. 不在本機保存 Drive access token；使用者重新整理後，必要時重新走 GIS 授權。
5. 還原仍先回到既有的「合併／取代」匯入預覽，不直接覆蓋目前 workspace。
