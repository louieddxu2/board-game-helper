# 貢獻指南

本專案是以桌遊為用途的實際網站。開源是分享程式實作，不是把它改造成通用平台；請先確認你的修改是在改善目前產品。

## 適合提交的修改

- bug 修正、測試、可及性、效能和安全性。
- 文件、翻譯、開發工具和本機開發體驗。
- 不擴大資料責任範圍的匯入、匯出、快取或離線流程改善。
- 能清楚說明使用情境和相容性影響的功能修改。

## 不要提交的內容

請不要提交：

- production D1 dump、正式備份、私人匯入檔或完整資料快照。
- Google Drive token、OAuth secret、Session、帳號資料或其他憑證。
- 未確認授權的遊戲資料、規則、翻譯、評分或第三方內容。
- 只為了「通用化」而新增的大量設定、模板或 adapter。

`src/content/zh-TW.json` 的作者文案與 `terms` 是受保護的原始內容；除非作者明確要求，請不要修改、翻譯、潤飾或搬移其意義。

## 開始前

1. 先閱讀 [開源方向](docs/open-source-direction.md) 和 [內容資料邊界](CONTENT-DATA-NOTICE.md)。
2. 小型修正可以直接開 Pull Request；schema、API、權限、OAuth、備份或資料來源變更，請先開 issue 說明影響。
3. 一次 Pull Request 只處理一個問題，並補上相應測試或說明。
4. 若使用 AI 輔助，請自行檢查程式、資料權利、測試和安全影響；提交者仍要對變更負責。

## 本機驗證

```powershell
npm install
npm run check:protected-copy
npm run typecheck
npm run test:core
npm run build
```

完整發布門檻是 `npm run test:release`。請不要使用正式 D1 進行本機測試。

提交到本 repository 的程式碼貢獻，依根目錄 `LICENSE` 的 Apache-2.0 條款處理；內容資料不適用該授權。
