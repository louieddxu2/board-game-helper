# 計分板整合

萬用桌遊計分板是獨立的 App，有自己的 Worker 與 D1。它透過 Cloudflare Service Binding 呼叫本站 Worker 的內部 RPC `ScorepadApi`，取得遊戲名稱、BGG 編號，以及單款遊戲的規則。

計分板不再直接讀取本站 D1（`board-game-rules-prod`）。先前它用 D1 binding 直接讀 `games`、`game_aliases`、`game_external_ids`、`game_catalog_entries`、`game_catalog_clock`，沒有排除隱藏與已合併的遊戲；現在一律由本站過濾。

## 計分板 Worker 的設定

```jsonc
"services": [
  { "binding": "RULES", "service": "board-game-helper", "entrypoint": "ScorepadApi" }
]
```

`binding` 名稱由計分板自訂。呼叫方式：`await env.RULES.lookupGamesByBgg(["13"])`。

## 介面

實作在 [`worker/scorepadApi.ts`](../worker/scorepadApi.ts) 與 [`worker/data/scorepadCatalog.ts`](../worker/data/scorepadCatalog.ts)，由 `worker/index.ts` 另外 export。RPC 方法不經過 `fetch`，沒有公開網址、CORS 或 Session；所有方法都只讀，不寫入任何資料。

「可列出的遊戲」是本站公開頁面列出的遊戲（`visibility = 'public'` 且 `merged_into_game_id IS NULL`），再加上帶 BGG 編號的隱藏遊戲：本站會把規則文字提到、名稱尚待審核的資料片或版本先建成隱藏遊戲，它們有 BGG 編號時計分板仍可遊玩，並經 `getRuleSummaryByBgg` 對到本體規則（migration 0136 把當時已有的這類遊戲重送一次目錄變更）。已合併的遊戲一律不列出。`review_status = 'pending'` 只表示遊戲資料等待編輯確認（批次匯入的遊戲都是這個狀態），公開頁面照樣顯示，所以不作為過濾條件。

### `lookupGamesByBgg(bggIds: string[])`

```ts
Promise<Array<{ bggId: string; gameId: string; displayName: string; englishName: string | null; aliases: string[] } & RuleRef>>

// 規則在哪款遊戲（見下方「目錄裡的規則數」）
type RuleRef = { ruleGameId: string | null; publishedRuleCount?: number; ruleVersion?: string };
```

- 用於管理員發布或登記官方計分板時查少數幾款遊戲。
- 最多 100 個 ID；超過、不是陣列或含非正整數字串時直接拒絕，不查詢 D1。重複的 ID 只查一次。
- BGG 編號同時查 `games.bgg_id`（整數）與 `game_external_ids`（`source = 'bgg'`，含 `primary` 與 `edition`）。同一個 BGG 編號可能對到多款遊戲，每款各一筆。
- 只回傳可列出的遊戲，別名也只取這些遊戲的。查不到或不可列出的 ID 不會出現在結果中。
- 結果依 `bggId`、`gameId` 排序。

### `currentGameCatalogVersion()`

```ts
Promise<number>
```

讀 `game_catalog_clock` 的目前版本（1 列）。

### `listGameChangesSince(afterVersion: number, limit: number)`

```ts
Promise<{
  changes: Array<{
    gameId: string; catalogVersion: number; bggIds: string[]; deleted: boolean;
    displayName?: string; englishName?: string | null; aliases?: string[];
  } & Partial<RuleRef>>; // 未刪除時帶 RuleRef
  throughVersion: number;
  hasMore: boolean;
}>
```

- 每週增量同步用。以 `game_catalog_entries.catalog_version` 分頁，和本站公開目錄同一個游標；`limit` 為 1–200，`afterVersion` 為非負整數。
- 下一頁傳入上一頁的 `throughVersion`；`hasMore` 為 `false` 時已讀完。沒有變更時 `throughVersion` 等於傳入的 `afterVersion`。
- 遊戲是否可列出依目前的 `games` 資料判斷。已刪除、已合併、或隱藏且沒有 BGG 編號的遊戲以 `deleted: true` 回傳，只帶 `gameId`、`catalogVersion` 與 `bggIds`，計分板應移除這款遊戲的規則名稱。已從資料庫刪除的遊戲沒有 BGG 編號可回傳，`bggIds` 為空陣列，請以 `gameId` 對應。
- `bggIds` 同樣合併 `games.bgg_id` 與 `game_external_ids` 兩個來源。
- `games.bgg_id` 與 BGG 外部編號的變更也會推進目錄版本（migration 0130），所以新增、修改或移除 BGG 編號都會出現在下一次同步。

### 目錄裡的規則數（`RuleRef`）

`lookupGamesByBgg` 與 `listGameChangesSince` 的每款遊戲都帶規則所在位置，計分板因此能在本機顯示「N 條規則」，打開遊戲時不必呼叫 `getRuleSummaryByBgg`：

- 可列出的本體遊戲：`ruleGameId` 是自己，並帶 `publishedRuleCount`（含未審核）與 `ruleVersion`（與 `getRuleSummaryByBgg`、`getGameRules` 相同）。
- 資料片、版本與變體：`ruleGameId` 是它對到的公開本體，不帶數量與版本。請讀本體那一筆的 `publishedRuleCount` 與 `ruleVersion`；只有本體那筆會隨規則變動更新，所以不在資料片上複製一份。
- `ruleGameId: null`：本站沒有這款遊戲的規則（隱藏的本體、沒有對到公開本體的資料片）。
- 已發布規則的數量或最新時間改變時，觸發器會推進本體的目錄版本；資料片關係新增、修改或刪除時，推進資料片的版本。所以下次增量同步就會拿到新的數量與 `ruleVersion`。
- 數量的新舊取決於計分板同步的頻率。`getRuleSummaryByBgg` 仍可用於本機目錄還沒有這款遊戲時。
- 讀取成本：本體遊戲的欄位在已讀的 `games` 列上，不多讀；資料片多讀一筆關係與一筆本體（約 2 列）。
### `getRuleSummaryByBgg(bggId: string)`

```ts
Promise<{ ruleGameId: string; publishedRuleCount: number; ruleVersion: string } | null>
```

- 本機目錄沒有這款遊戲時的備援：先顯示「N 條規則」，不讀規則本身。目錄已帶 `RuleRef` 時不必呼叫。
- 和網站相同，資料片、版本與變體一律對到本體遊戲：`ruleGameId` 是本體遊戲，數量與版本也是本體的。BGG 編號同時查 `games.bgg_id` 與 `game_external_ids`。
- `publishedRuleCount` 包含尚未審核的規則。
- `ruleVersion` 在已發布規則新增、修改、隱藏、刪除或移動時改變。計分板把它和自己快取的版本比對，相同就不必讀規則。審核通過一條規則、新增或移除外部資源不改變版本；快取裡的審核標記、外部資源與重要票數，要到下次規則變動或計分板自己的快取到期才更新。
- 資料片或版本只要未被合併，即使本站仍隱藏（名稱待審），也和網站一樣對到公開的本體。沒有可列出的本體遊戲時回傳 `null`。格式不是正整數字串時直接拒絕，不查詢 D1。查詢依序嘗試：本體遊戲自己的 `games.bgg_id`、本體遊戲的版本編號、資料片或版本對到的本體，找到第一筆就停止；若資料錯誤使一個 BGG 編號屬於兩款遊戲，以較前的順序為準（遊戲資料健檢會列出這種重複）。

### `getGameRules(gameId: string)`

```ts
Promise<{
  gameId: string; slug: string; displayName: string; englishName: string | null;
  ruleVersion: string;
  rules: Array<{
    id: string; statement: string; commonMistake?: string; details?: string; flowStage?: FlowStage;
    categories: RuleCategory[]; playerCounts: number[]; editionNotes: string[];
    sourceLinks: Array<{ label?: string; url: string }>;
    reviewStatus: 'not_required' | 'pending' | 'reviewed'; importanceCount: number; tagIds: string[];
    createdAt: number; updatedAt: number;
  }>;
  tags: Array<{ id: string; name: string; categoryHints: RuleCategory[]; detectionKeywords: string[] }>;
  externalResources: Array<{ id: string; name: string; category: 'teaching' | 'help_card' | 'faq'; url: string }>;
} | null>
```

- 計分板只在玩家點開規則、而且本機快取的版本與 `ruleVersion` 不同時呼叫；進入遊戲不呼叫。
- 傳入目錄或 `getRuleSummaryByBgg` 的 `ruleGameId`。不是可列出的本體遊戲（資料片、隱藏、已合併或不存在）時回傳 `null`；格式不符的 ID 直接拒絕，不查詢 D1。
- 回傳全部已發布規則，包含未審核的（`reviewStatus: 'pending'`），順序與網站的遊戲頁查詢相同。排序、未審核的標示與重要票數的用法由計分板決定。
- 不回傳貢獻者、編輯者、審核者與修改紀錄。
- `tags` 是這些規則用到的 Tag，與網站遊戲頁載入的相同（名稱、分類提示與偵測關鍵字），以 `tagIds` 對應。沒有自訂分類的規則靠 Tag 的分類提示得到自動分類。
- 連到網站的單條規則：`/games/{slug}#rule-{id}`。

## 共用的規則篩選

計分板逐字複製 [`src/shared/ruleFilter.ts`](../src/shared/ruleFilter.ts) 與它唯一引用的 [`src/shared/ruleTypes.ts`](../src/shared/ruleTypes.ts)，以 `computeRuleFilter(rules, publicTags, view, query)` 做和網站相同的搜尋、分類、Tag、人數與版本篩選；排序由各自決定。規則的 `tags` 以 `getGameRules` 的 `tags` 依 `tagIds` 組回；`publicTags` 傳入同一份 `tags`。

[`scripts/shared-rule-filter.test.ts`](../scripts/shared-rule-filter.test.ts) 記錄兩個檔案的雜湊，也檢查它們沒有引用其他檔案。改動任一檔案後，把兩個檔案複製到計分板，並同時更新兩邊測試裡的雜湊。

## 成本

以 Cloudflare 免費方案為前提（每次呼叫最多 50 個 D1 查詢、10 ms CPU）：

- 每個方法固定只執行 1 個 D1 查詢，不隨 ID 數量或 `limit` 增加，也不使用快取。
- 以本機 Miniflare D1 實測 `rows_read`：`getRuleSummaryByBgg` 本體遊戲 1 列、本體的版本編號 2 列、資料片 6 列、查無此編號 0 列。`getGameRules` 讀遊戲、已發布規則（內容與 Tag ID 各一次）、用到的 Tag 與外部資源，2 條規則時為 12 列，隨規則數線性增加；不可列出的遊戲只讀 1 列。
- 查詢計畫由 [`scripts/scorepad-rules.test.ts`](../scripts/scorepad-rules.test.ts) 檢查。
- 查詢由 ID 清單（`json_each(?)` 搭配 `CROSS JOIN`）或變更頁驅動，每一段都走索引；`IN (...)` 列出較多 ID 時 SQLite 會改成掃描 `game_external_ids`，所以不使用。執行計畫由 [`scripts/scorepad-api.test.ts`](../scripts/scorepad-api.test.ts) 檢查。

## 原則

本站公開 API 只給本站自己的頁面使用：

- 跨網站讀取只回應本站來源（`APP_ORIGIN`）與本機開發用的 `TRUSTED_APP_ORIGINS`，其他網站在瀏覽器中無法讀寫。
- 登入只使用本站 cookie，不提供 Bearer token。
- 2026-11-06 已移除先前未使用的整合：公開讀取的 `Access-Control-Allow-Origin: *`、`/api/auth/google/exchange`、TypeScript client 與 OpenAPI 文件；2026-11-20 再移除計分板早期使用的 `/api/games/resolve` 等逐次查詢的公開搜尋 API。

原因：本站沒有自訂網域，無法使用 Cloudflare 的伺服器端快取，每個公開讀取請求都會查詢 D1。開放跨網站讀取，等於讓任何網站都能透過訪客的瀏覽器消耗本站的 D1 讀取量；公開 API 仍可被程式直接呼叫，對 D1 用量的保護只有每個 IP 的讀取頻率限制（`PUBLIC_RATE_LIMITER`）。

計分板需要新資料時，在 `ScorepadApi` 增加方法，不要：

- 讓計分板直接讀取本站 D1；
- 重新對所有網站開放跨網站讀取（`Access-Control-Allow-Origin: *`）；
- 把金鑰放在計分板的瀏覽器端程式碼，任何人都能從網頁原始碼取得並冒用。

Service Binding 無法使用時（例如兩個 Worker 不在同一個 Cloudflare 帳號），才改用存放在計分板 Worker secrets 的伺服器端金鑰，並依金鑰限制用量。
