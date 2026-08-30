# Google Drive 資料夾式備份

## 目前結論

動態表格目前應維持「本機資料為主」：IndexedDB 是即時使用的資料來源，Google Drive 只提供備份與還原，不先做多裝置即時同步或自動合併。

本機「匯出全部資料」與 Google Drive 備份共用同一套資料夾式格式，外層以 ZIP 打包；每張表仍是可攜式 `.xlsx`，包含資料頁與獨立設定頁。Google Drive 版本可逐表更新，避免每次備份都重寫一個巨大檔案。

## 本機下載格式

「匯出全部資料」會下載 `BoardGameHelper-動態表格備份.zip`，內容與雲端資料夾結構一致：

```text
BoardGameHelper-動態表格備份.zip
└─ BoardGameHelper/
   └─ 動態表格備份/
      ├─ manifest.xlsx
      ├─ 桌遊/
      │  ├─ 收藏表.xlsx
      │  └─ 遊玩紀錄.xlsx
      └─ 工作/
         └─ 待辦事項.xlsx
```

ZIP 內不使用 JSON 檔。`manifest.xlsx` 保存本機資料夾與表格結構；本機版本不填入 Google Drive file ID，避免保存沒有意義的雲端指標。整個資料庫匯入優先讀取 ZIP，也仍相容既有的單一 Workspace `.xlsx`。

## 雲端結構

```text
BoardGameHelper/
└─ 動態表格備份/
   ├─ manifest.xlsx
   ├─ 桌遊/
   │  ├─ 收藏表.xlsx
   │  └─ 遊玩紀錄.xlsx
   └─ 工作/
      └─ 待辦事項.xlsx
```

資料夾和表格檔案都帶有 `appProperties.backupKey`、`backupKind` 與本機穩定 ID。`manifest.xlsx` 是一張可開啟的索引試算表，保存目錄樹、排序、表格與 Drive file ID；每張表格的 `.xlsx` 內含資料頁與獨立設定頁，因此備份內容不使用 JSON 檔。舊有單一 XLSX 備份仍可被尋找並還原；新的備份會使用資料夾格式。

## Google 授權方向

目前網站的 Google 登入只驗證使用者身分，並不代表已取得 Google Drive 操作權限。Drive 備份需要另外走 Google Identity Services 的 OAuth 授權流程。

目前依照 `C:\architecture-kits\kits\google-drive-single-file-backup` 採用瀏覽器端 Google Identity Services token flow：

1. 每次重新開啟網頁後，使用者在 workspace 的目錄彈窗中按下「連結 Google Drive」一次；連結成功後，當次工作階段才會執行自動備份。
2. 前端以獨立的 Google Drive OAuth Web Client ID，向 Google 申請 `drive.file` access token；網站登入使用的 Client ID 不會被替換。
3. access token 僅保存在當次頁面工作階段的記憶體，不寫入 localStorage、IndexedDB、URL 或 Worker。
4. 前端直接呼叫 Drive v3，建立／更新標記過的資料夾、XLSX 表格檔與 manifest 試算表。

這和現有 Google 登入保持分離：網站登入只驗證使用者身分，Drive 授權只在使用者主動按下連結按鈕時發生。兩者各自使用不同的 Client ID、Token 與 scope。重新整理頁面後不保留 token；每個新工作階段都需要按一次連結按鈕，但 GIS 會沿用既有同意紀錄，不應每次強制 `prompt=consent`。連結後若 token 在同一工作階段內過期，由 token provider 再向 GIS 取得新 token。

若未來需要無人值守的排程備份、多裝置背景同步，才另行評估 authorization code flow、refresh token 加密保存與 Worker 端 API；那會是不同的安全與資料責任範圍，不屬於目前第一版。

官方文件：

- [Google Identity Services：Web 上的 OAuth 2.0](https://developers.google.com/identity/oauth2/web/guides/overview)
- [Google Drive API：選擇授權 scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## Scope 選擇

### 第一版：`drive.file`

備份資料夾是使用者看得見、也能自行管理的檔案。`drive.file` 只讓 App 建立或修改自己建立的檔案，不掃描使用者整個 Drive；這符合資料夾式備份的需求。

不需要 Google Sheets API，也不應把 XLSX 轉成 Google 試算表；目前的設定頁、欄位屬性與 v1 相容性都由既有 XLSX 格式負責。

### 可選方向：`drive.appdata`

如果未來明確希望備份檔完全隱藏、不讓使用者在 Drive 介面中管理，可以改用 `appDataFolder`。它只供 App 存取，檔案不會顯示在一般 Drive 介面；這比較適合內部設定，不一定適合使用者想自行下載、保留或手動還原的備份。

官方文件：[Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)

## 第一版資料流

```text
本機編輯 → IndexedDB 儲存 → 標記有未備份變更
                         ↓ 當次工作階段已由使用者連結 Drive
                  每張表格每 30 分鐘最多自動備份一次
       更新目錄資料夾 → 更新有變更的表格 XLSX → 更新 manifest 試算表
```

還原則反向執行，但在真正覆蓋本機資料前，必須先經過自訂衝突確認介面。第一版不做單格合併：選擇「保留本機」、「使用雲端」或「取消」。

本機下載／匯入則是：

```text
本機 Workspace → manifest.xlsx + 各表格 XLSX → ZIP 下載
ZIP 上傳 → 驗證 manifest 與各表格 → 合併／取代預覽
```

上傳檔案可先採用單次 multipart upload；若未來備份檔變大或需要顯示進度，再改用 resumable upload。Drive API 官方說明：[Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)。

## 雲端檔案

- `manifest.xlsx`：目錄樹、穩定 ID、排序、各表格 file ID、版本；內容為可開啟的索引工作表。
- `資料夾`：依本機資料夾樹建立，移動時更新 Drive parent。
- `表格.xlsx`：一張表一個檔案，包含資料工作表與完整欄位設定工作表。
- `appProperties`：`backupKey`、`backupKind`、`localId`、`schemaVersion`、`backedUpAt`、`sourceUpdatedAt`。
- 本機只保存 manifest file ID、時間與表格／資料夾數量，不保存 access token 或內容。

`appProperties` 可讓 App 在不掃描整個 Drive 的情況下找回自己的備份檔。Drive API 支援使用 `appProperties` 搜尋檔案：[Search for files and folders](https://developers.google.com/workspace/drive/api/guides/search-files)。

## PWA 與離線行為

- 離線時仍可照常編輯本機資料。
- 沒有網路時，備份按鈕顯示離線狀態，不能假裝已完成。
- 恢復連線後，若當次工作階段仍持有 Drive 授權且有待備份變更，自動備份排程會繼續；重新載入頁面後仍需由使用者按一次連結按鈕。
- 自動備份只在網頁／PWA 執行中的前景工作階段運作，不把 Service Worker 當成無人值守的上傳程序。
- 還原屬於高風險動作，不應在背景自動執行。
- Service Worker 不需要保存 Google token，也不應代替 OAuth 流程。

## 目前不做的事情

- 不把 Google Drive 當成即時資料庫。
- 不在伺服器保存 access token、refresh token 或使用者的整份 workspace 內容。
- 不掃描或列出使用者整個 Drive。
- 不自動合併兩台裝置的格子變更。
- 不把資料轉成 Google Sheets 原生格式。

## 第一版已決定的範圍

1. 備份資料夾讓使用者在 Drive 中看得到，使用 `drive.file`。
2. Drive 授權與還原由使用者主動觸發；連結成功後可在當次工作階段自動備份，每張表格每 30 分鐘最多一次。
3. Drive 上維護一個 manifest 與每張表格／資料夾的對應項目，靠 app properties 找回，不每次建立重複檔案。
4. 不在本機保存 Drive access token；使用者重新整理後，必要時重新走 GIS 授權。
5. 還原仍先回到既有的「合併／取代」匯入預覽，不直接覆蓋目前 workspace。
