# 彈窗與上一頁

`uiHistory` 是全站唯一的暫時 UI 歷史管理器。`useWorkspaceBrowserBack` 保留既有名稱，但搜尋、確認、輸入、遊戲編輯、收藏上限、刪帳號與工作區都使用它。

## 註冊與關閉

- UI 打開時以 `active` 註冊；每層推入同 URL 的 `pushState`，保留其他 history.state 欄位並增加 React Router `idx`。
- `owner` 識別元件；歷史標記包含 session、baseline 索引及當時完整 UI 堆疊。
- 每個獨立巢狀彈窗都註冊自己的 owner。工作區共用控制器以實際開啟的狀態數量傳入 `layerCount`，並用 `onDismissLayers(count)` 依優先順序關閉相應層數。
- `onBack`／`onDismissLayers` 必須同步請求關閉 UI，例如更新 React state；確認視窗則取消並 resolve `false`。不得只顯示通知而繼續維持 active。
- 忙碌時已有禁止取消的 UI 傳入 `canDismiss: false`。返回會恢復該層紀錄，不會留下仍開啟卻沒有紀錄的彈窗。
- 手動關閉會非同步退回共同前綴，再補入仍存在的層。關閉與重新開啟的更新在同一管理器內協調。
- 真正 unmount 才移除 owner；微任務延後清理讓 StrictMode 的 effect replay 不會多推一筆。
- 彈窗共用計數式 scroll lock；關閉所有彈窗時能恢復 body 原本的 overflow。工作區非模態狀態傳入 `lockScroll: false`。

## Router 與導頁

管理器在 capture phase 處理 UI POP；只消耗頂層或實際遍歷到的層，不讓多個 owner 各自處理同一事件。消耗 UI 時維持原本路由；跨 baseline 的 `go(-N)` 先關 UI 並回復 baseline。

App 使用 `connectUiHistoryRouter(router)`，透過 Router blocker 暫存 PUSH／REPLACE，等 UI 的非同步 history 清理完成後再 proceed。一般 Link、redirect 與手動關閉後立即導頁都走相同程序。

搜尋選取、彈窗內的導頁，以及確認後離頁，可使用 hook 回傳的 `navigateAfterClosing(() => navigate(target))` 或 `uiHistory.navigate(action)`。這會取消全部 UI，先回到 baseline，再執行 action；`replace` 若有需要也因此替換原路由，不會替換頂層 UI 紀錄。清理期間再次請求導頁時採最新目的地。

`observeRoute` 是外部／未受 blocker 管理之 route push 的備援：取消殘餘 UI，記住目的地索引，並解除被 pushState 取消的待處理清理。

## Forward 與重新載入

已關閉的彈窗不會因 Forward 重新開啟。碰到舊 UI 項目時，Back 跳回 baseline；Forward 若有後續路由則跳到該目的地，否則回到 baseline。

History API 無法直接刪除任意中間項目，所以關閉後 `history.length` 不一定下降；使用者看到的導覽會跳過已消耗的 UI 項目。正確性須一起檢查目前 state、UI 與之後的 Back／Forward。

sessionStorage 僅保留 session id、baseline／目的地歷史索引，讓重新載入後仍能跳過舊 UI 到達後續路由。不可寫入表格、帳號或頁面內容。儲存不可用時，同一文件內仍可管理歷史。

上一版 `{ owner, depth }` 格式殘留的 UI 項目在啟動／遍歷時回退清理，直到回到原路由紀錄。

## 鍵盤與驗證

保留 visualViewport 高度與鍵盤剛收起的 500ms 判斷：判定第一次返回在收起軟鍵盤時，恢復 UI entry；下次才關彈窗。實體 Android／iOS 的鍵盤事件時序仍需裝置驗證，桌面行動尺寸不能代替軟鍵盤。

回歸測試使用真實 jsdom History API 的 back／forward／go，並在 manager 註冊前以 capture listener 觀察 POP，避免以合成事件或立即成立的等待誤判。維護案例位於：

- `src/workspace/useWorkspaceBrowserBack.test.ts`
- `src/workspace/uiHistory.test.ts`
- `src/workspace/uiHistoryRouter.test.ts`
- `src/pages/WorkspaceBrowserBack.test.tsx`
- `src/components/SearchModal.test.tsx`
- `src/components/WorkspaceDialogBrowserBack.test.tsx`

測試清理需先等待實際 traversal 完成，再 dispose 管理器；不可只還原目前 history.state，讓上一個案例的待處理 POP 進入下個案例。
