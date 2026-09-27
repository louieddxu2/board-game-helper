# 測試品質盤點 — 2026-09-27

## 範圍與驗證

發布流程中的 Vitest、型別檢查及 6 個核心瀏覽器測試全數通過。Vitest 又獨立執行兩次，三次皆為 **120 檔、752/752 通過**；後兩次各約 40 秒。本次逐檔抽查 19/120 檔、343/752 個案例，優先選測試數多、執行時間長、最近的 Workspace 操作及發布守門案例。其餘檔案只做了檔名與靜態模式盤點，不能把抽查結論外推為全套皆無問題。

後兩次 JSON 報告顯示 `WorkspacePage.test.tsx` 單檔約 38 秒、104 個案例，是整套約 40 秒壁鐘時間的主要瓶頸。其餘較慢的檔案如 `attribute-history-replay.test.ts` 約 12 秒，但會實際執行 SQLite/migration 和資料回放，有具體的資料錯誤失敗訊號，不能只憑時間刪除。

## 優先處理的問題

1. **P1 — CSS 原始碼比對沒有驗證畫面。** `src/workspace/browser-policy.test.ts` 的 27 個案例中，22 個讀取 `src/styles.css` 並以正規表示式比對選擇器或宣告；`src/pages/CatalogPage.mobile-layout.test.ts` 另有 2 個同類案例。例如後者只找到第一個 `.catalog-mobile-rule-card` 宣告中的 `clamp(88px, 27vw, 108px)`，並不檢查手機上卡片是否可見、內容是否溢出。記憶體內的反例探測：在 CSS 後面追加同媒體查詢的 `.catalog-mobile-rule-card { display: none !important; }`，現有比對仍會通過。建議保留 CSP、PWA manifest 這類可直接讀取的設定契約，把 CSS 的 24 個源碼測試合併為少量**實際手機 viewport 的畫面／幾何斷言**，再移除源碼比對。`browser-policy.test.ts:19` 與 `:273` 重複檢查同一個 PWA 首頁捷徑；`:29` 與 `:408` 也重複檢查 `100dvh`，可在遷移時合併。估時：中。
2. **P1 — 測試名稱涵蓋的後半段沒有斷言。** `src/pages/AttributesPage.test.tsx:131` 宣稱「換一個遊戲保留方向、換一組重新選方向」，但點擊「不知道，換一組」後就在 `:141` 結束。即使該按鈕不產生新方向，測試仍可能通過。應控制隨機值並斷言新問題的方向／文案，或拆成兩個案例。估時：小。
3. **P1 — 新的多選／拖曳仲裁缺少真實觸控守門案例。** `src/pages/WorkspacePage.test.tsx:213-299` 的 JSDOM 案例有檢查選中格數及捲動值，值得保留；但自行覆寫 `getBoundingClientRect`、`document.elementFromPoint` 並合成 pointer event。現有 `tests/core` 瀏覽器流程沒有 Workspace 長按掃選。建議增加一個手機 viewport 的瀏覽器案例，從中央帶長按並掃過數列，然後從側帶和 2:1 斜線拖曳，斷言選格與實際列表位移；這會直接抓到瀏覽器事件、命中位置與 CSS 疊層的錯誤。估時：中。
4. **P2 — 固定睡眠拖慢測試，也讓時序依賴不清楚。** `WorkspacePage.test.tsx` 有 17 處 `await ...setTimeout(...)`，`workspaceDialogs.test.tsx` 有 2 處，`AttributesPage.test.tsx` 有 1 處；部分長按 helper 會被多個案例重複呼叫。時間門檻本身可用 fake timers 推進，動畫完成則應等待可觀察狀態。先替換 Workspace 長按／邊緣停留的等待，再比較單檔耗時，避免為了縮短時間刪掉行為測試。估時：中。
5. **P2 — 操作者腳本只測字串，不測執行。** `scripts/rebuild-attribute-catalog.test.ts:5` 的單一案例只要求檔案含 `runCompleteAttributeReplay`。在記憶體內把 `await runCompleteAttributeReplay(...)` 改成註解，三個現有字串斷言仍會通過。可把腳本流程抽成可注入遠端 D1 執行器的函式，測試實際呼叫順序與失敗時停止；完成後移除字串測試。估時：中。
6. **P2 — SQL 產生測試沒有執行 SQL。** `worker/data/gameEntities.test.ts:33` 只用假的 DB 收集 statement 數、SQL 片段及部分 binding；錯誤 SQL 或約束違反未必被發現。至少保留一個實際 SQLite 案例，斷言模糊名稱不會被誤分類、已有 entity 不會被重建。估時：中。

## 逐檔判讀

嚴重度表示需要改善的優先程度；「低」包含目前可保留的案例。測試數取自 Vitest JSON 報告，`each` 展開後計數。

| 測試檔 | 數量 | 嚴重度 | 判讀與處置 | 估時 |
|---|---:|---|---|---|
| `src/pages/WorkspacePage.test.tsx` | 104 | 中 | 多數有可見格值／捲動結果；保留。長按與邊緣案例改用受控時計；補真實手機觸控流程。 | 中 |
| `src/lib/api.test.ts` | 41 | 低 | 比較 API 回傳、快取命中與網路行為，失敗訊號具體；保留。 | 無 |
| `src/workspace/browser-policy.test.ts` | 27 | 高 | 22 個 CSS 文字比對不等於版面行為，重複的 manifest／高度斷言可合併；遷移到瀏覽器驗證。 | 中 |
| `src/workspace/spreadsheet.test.ts` | 22 | 低 | 除往返匯入外，也獨立檢查 workbook 頁籤、格式版本與損壞欄位；資料毀損會明確失敗，保留。 | 無 |
| `src/pages/AttributesPage.test.tsx` | 20 | 高 | `:131` 案例缺新方向斷言；`:143` 起的單一巨大案例混合開場版面、歷史資料、範例、滑桿與建議，可按行為拆分。`beforeEach` 約 20 個 spy 應縮到各案例需要的邊界。 | 中 |
| `src/workspace/model.test.ts` | 19 | 低 | 動態選項去重、日期、樹狀刪除等輸出可觀察且有邊界，保留。 | 無 |
| `src/components/RuleCard.test.tsx` | 18 | 低 | 互動、權限與可存取名稱有具體斷言；少量 CSS class／標籤形狀斷言可在相關重構時再修。 | 小 |
| `src/workspace/workspaceShared.test.ts` | 16 | 低 | 對話框焦點、Esc、視覺鍵盤內的捲動範圍有可觀察結果，保留。 | 無 |
| `src/lib/attributeCollection.test.ts` | 14 | 低 | 集合範圍、去重與候選抽樣涵蓋邊界，保留；常數 `=10` 斷言可在調整演算法時檢討是否為產品契約。 | 小 |
| `worker/attribute-scoring.test.ts` | 13 | 低 | 分數變動方向、範圍、重複事件及順序是明確數值行為，保留。 | 無 |
| `src/workspace/useMomentumScroll.test.ts` | 13 | 低 | 模擬動畫影格並斷言捲動距離／邊界；雖有內部係數斷言，主體是可感知的慣性行為，保留。 | 無 |
| `src/workspace/useTableGestures.test.ts` | 10 | 低 | 3:1 斜率、中央帶邊界與抽屜手勢門檻皆是這次明定的操作契約，保留。 | 無 |
| `src/workspace/workspaceDialogs.test.tsx` | 9 | 中 | 拖動選項時的邊緣停留測試有捲動斷言；兩次 350ms 固定睡眠改受控時計。 | 小 |
| `scripts/attribute-history-replay.test.ts` | 7 | 低 | 真 SQLite/migration 回放、互斥鎖和資料保存，失敗後果明確；保留，慢不等於多餘。 | 無 |
| `scripts/catalog-outbox-activation.test.ts` | 1 | 低 | 執行 migration 後檢查 trigger、index plan 與實際 outbox 內容；保留。 | 無 |
| `scripts/core-release-gate.test.ts` | 3 | 中 | 發布順序是重要安全契約，但以 `indexOf`／`toContain` 測原始字串可被死碼騙過；保留守門目的，後續改測腳本執行路徑。 | 中 |
| `scripts/rebuild-attribute-catalog.test.ts` | 1 | 高 | 註解掉真正的回放呼叫仍可通過；以可注入執行器的行為測試取代。 | 中 |
| `src/pages/CatalogPage.mobile-layout.test.ts` | 2 | 高 | 只測 CSS 文字；轉成手機畫面內容可見、兩欄寬度與不溢出的斷言。 | 中 |
| `worker/data/gameEntities.test.ts` | 3 | 中 | 假 DB 上的 SQL 結構檢查可作小型單元測試，但缺實際寫入與重複資料結果；補 SQLite 整合案例。 | 中 |

## 六個品質面向

- **可讀性：** `AttributesPage.test.tsx:143` 的開場案例含多種互不相依的 UI 規格，失敗時要重新辨認測試真正意圖；拆成數個具名行為案例。大型 fixture 本身不是刪除理由。
- **穩定性：** 20 處固定睡眠是明確風險；三次全套皆綠只能證明本機當下穩定，不能證明不同負載下不會偶發失敗。改用受控時計與狀態等待。
- **診斷力：** 缺少後半段斷言的「換一組」案例與純字串的操作腳本案例可能在行為壞掉時維持綠燈。斷言實際新方向和實際回放呼叫。
- **設計：** CSS 解析測試與實際渲染脫節；假 SQL DB 只檢查語法片段。保留少量設定契約，將使用者行為移至瀏覽器／SQLite 邊界。
- **AI 生成風險：** 沒有可靠的逐檔作者來源，因此不推定測試由 AI 產生；但上面兩個記憶體內變異探測均存活，顯示某些測試只描述目前程式形狀。沒有安裝 mutation runner，本次**不報數值 mutation score**。
- **覆蓋：** Workspace 手勢在 JSDOM 有數值與選格斷言，核心瀏覽器 suite 沒有真實觸控仲裁；優先補一條手機操作結果的端到端流程。

本次是盤點，沒有改寫測試或增加新品質 gate。現階段直接全面禁止 `readFileSync`／字串比對會誤擋合理的 CSP、manifest 與 migration 契約；應先遷移上表指出的 CSS 與腳本案例，再考慮對 UI CSS 原始碼測試加專用 lint 規則或檢查。也不建議單純以測試數目設定刪除目標。
