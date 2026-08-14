# Google Drive 備份研究與規劃

## 目前結論

動態表格目前應維持「本機資料為主」：IndexedDB 是即時使用的資料來源，Google Drive 只提供備份與還原，不先做多裝置即時同步或自動合併。

目前的完整匯出格式已經可以作為備份檔：整個資料庫匯出為一個 `.xlsx`，包含 Workspace 目錄、每張表的資料頁與獨立設定頁。備份功能應直接重用 `src/workspace/spreadsheet.ts` 的 `exportWorkspaceXlsx()`／`importWorkspaceXlsx()`，避免另做一套可能不一致的格式。

## Google 授權方向

目前網站的 Google 登入只驗證使用者身分，並不代表已取得 Google Drive 操作權限。Drive 備份需要另外走 Google Identity Services 的 OAuth 授權流程。

建議使用 authorization code flow：

1. 使用者在自訂的「Google Drive 備份」介面按下連結。
2. 前端透過 Google Identity Services 取得授權碼。
3. Cloudflare Worker 後端交換 access token 與 refresh token。
4. refresh token 加密保存於伺服器端，前端只知道連結狀態，不接觸長期 token。
5. Worker 代表使用者呼叫 Drive API 上傳或下載備份檔。

這和現有 Google 登入保持分離：使用者可以登入網站，但不連結 Drive；也可以在 workspace 中稍後才授權備份。

官方文件：

- [Google Identity Services：使用 authorization code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google OAuth 2.0：Web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
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
   ↓ 使用者按下立即備份，或線上時執行排程備份
產生目前完整 XLSX
   ↓
Drive files.create / files.update
   ↓
保存 fileId、checksum、備份時間與格式版本
```

還原則反向執行，但在真正覆蓋本機資料前，必須先經過自訂衝突確認介面。第一版不做單格合併：選擇「保留本機」、「使用雲端」或「取消」。

上傳檔案可先採用單次 multipart upload；若未來備份檔變大或需要顯示進度，再改用 resumable upload。Drive API 官方說明：[Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)。

## 建議的備份檔

- 顯示名稱：`玩錯動態表格-備份.xlsx`
- MIME type：`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- 內容：目前完整 Workspace XLSX，不另建第二種資料格式
- `appProperties`：`schemaVersion`、`workspaceFormat`、`exportedAt`、`checksum`
- 本機保存：Drive `fileId`、最後備份 checksum、最後備份時間、目前是否 dirty

`appProperties` 可讓 App 在不掃描整個 Drive 的情況下找回自己的備份檔。Drive API 支援使用 `appProperties` 搜尋檔案：[Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files)。

## PWA 與離線行為

- 離線時仍可照常編輯本機資料。
- 沒有網路時，備份按鈕應顯示「待上傳」，不能假裝已完成。
- 恢復連線後，可依設定自動備份，或只提示使用者手動按下備份。
- 還原屬於高風險動作，不應在背景自動執行。
- Service Worker 不需要保存 Google token，也不應代替 OAuth 流程。

## 目前不做的事情

- 不把 Google Drive 當成即時資料庫。
- 不在伺服器保存使用者的整份 workspace 內容。
- 不掃描或列出使用者整個 Drive。
- 不自動合併兩台裝置的格子變更。
- 不把資料轉成 Google Sheets 原生格式。

## 待確認決策

1. 備份檔要讓使用者在 Drive 中看得到（`drive.file`），還是完全隱藏（`drive.appdata`）。
2. 第一版只提供手動備份，還是加入「連線後自動備份」。
3. Drive 上只保留一個目前備份檔，還是保留最近 N 個版本。
4. Google 帳號是否沿用目前網站登入的帳號，或允許連結另一個 Drive 帳號。
5. refresh token 的加密保存與解除連結後的刪除政策。
