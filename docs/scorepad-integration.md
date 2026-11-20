# 計分板整合

萬用桌遊計分板是獨立的 App，有自己的 Worker 與 D1。它透過 Cloudflare Service Binding 呼叫本站 Worker 的內部 RPC `ScorepadApi`，取得遊戲名稱與 BGG 編號。

計分板不再直接讀取本站 D1（`board-game-rules-prod`）。先前它用 D1 binding 直接讀 `games`、`game_aliases`、`game_external_ids`、`game_catalog_entries`、`game_catalog_clock`，沒有排除隱藏與已合併的遊戲；現在一律由本站過濾。

## 計分板 Worker 的設定

```jsonc
"services": [
  { "binding": "RULES", "service": "board-game-helper", "entrypoint": "ScorepadApi" }
]
```

`binding` 名稱由計分板自訂。呼叫方式：`await env.RULES.lookupGamesByBgg(["13"])`。

## 介面

實作在 [`worker/scorepadApi.ts`](../worker/scorepadApi.ts) 與 [`worker/data/scorepadCatalog.ts`](../worker/data/scorepadCatalog.ts)，由 `worker/index.ts` 另外 export。RPC 方法不經過 `fetch`，沒有公開網址、CORS 或 Session；三個方法都只讀，不寫入任何資料。

「可列出的遊戲」與本站公開頁面一致：`visibility = 'public'` 且 `merged_into_game_id IS NULL`。`review_status = 'pending'` 只表示遊戲資料等待編輯確認（批次匯入的遊戲都是這個狀態），公開頁面照樣顯示，所以不作為過濾條件。

### `lookupGamesByBgg(bggIds: string[])`

```ts
Promise<Array<{ bggId: string; gameId: string; displayName: string; englishName: string | null; aliases: string[] }>>
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
  }>;
  throughVersion: number;
  hasMore: boolean;
}>
```

- 每週增量同步用。以 `game_catalog_entries.catalog_version` 分頁，和本站公開目錄同一個游標；`limit` 為 1–200，`afterVersion` 為非負整數。
- 下一頁傳入上一頁的 `throughVersion`；`hasMore` 為 `false` 時已讀完。沒有變更時 `throughVersion` 等於傳入的 `afterVersion`。
- 遊戲是否可列出依目前的 `games` 資料判斷。已刪除、隱藏或已合併的遊戲以 `deleted: true` 回傳，只帶 `gameId`、`catalogVersion` 與 `bggIds`，計分板應移除這款遊戲的規則名稱。已從資料庫刪除的遊戲沒有 BGG 編號可回傳，`bggIds` 為空陣列，請以 `gameId` 對應。
- `bggIds` 同樣合併 `games.bgg_id` 與 `game_external_ids` 兩個來源。
- `games.bgg_id` 與 BGG 外部編號的變更也會推進目錄版本（migration 0130），所以新增、修改或移除 BGG 編號都會出現在下一次同步。

## 成本

以 Cloudflare 免費方案為前提（每次呼叫最多 50 個 D1 查詢、10 ms CPU）：

- 每個方法固定只執行 1 個 D1 查詢，不隨 ID 數量或 `limit` 增加，也不使用快取。
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
