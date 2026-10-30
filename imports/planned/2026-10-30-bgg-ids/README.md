# 已套用的 BGG ID 補填

狀態：使用者確認後，六款 BGG ID 已於 2026-10-30 22:10（Asia/Taipei）套用正式 D1，並發布六筆屬性增量；沒有重播或重建快取。Mountain Goats: Legacy 已於同日 21:20 合併，並完成名稱比對鍵修正，詳見[執行紀錄](../../../docs/game-name-identity-repair-2026-10-30.md)。新版 Worker 也已發布並通過正式站健康檢查。SQL 保留在 `imports/planned/` 作為執行紀錄，不會隨 migration 或一般部署自動執行。

## 已查證的補填

以下六款只修改 `games.bgg_id`。不另改名稱、別名、時間戳、遊戲分類或 `attribute_enabled`；現行資料庫會依 BGG ID 自動處理投票資格與屬性初始化。

| 現有名稱 | BGG 名稱 | BGG ID | 查證依據 |
| --- | --- | ---: | --- |
| Dance of Ibexes | Dance of Ibexes | 13005 | [BGG](https://boardgamegeek.com/boardgame/13005/dance-of-ibexes)：Wolfgang Kramer 的排數字板塊遊戲；現有別名為「山羊之舞」。 |
| 搜靈小隊 | GHOST | 470254 | [BGG](https://boardgamegeek.com/boardgame/470254/ghost) 與[代理商商品目錄](https://www.dogbarktrain.com/products)：排隊擲骰捕捉幽靈、使用小幽靈重擲、四輪後結算；2–6 人、15–20 分鐘。 |
| 天燈谷 | Valley of Sky Lanterns | 473111 | [BGG](https://boardgamegeek.com/boardgame/473111/valley-of-sky-lanterns)：Icerain Games；頁面列有「天燈谷」繁體中文規則。 |
| Click a tree | Click A Tree | 399959 | [BGG](https://boardgamegeek.com/boardgame/399959/click-a-tree)：Uwe Rosenberg 設計、Skellig Games 出版。 |
| 地下酒吧 | Speakeasy | 375459 | [BGG](https://boardgamegeek.com/boardgame/375459/speakeasy)：現有英文名一致；Vital Lacerda 的禁酒時期經營遊戲。 |
| 甜蜜國度 | Sweet Lands | 425445 | [BGG](https://boardgamegeek.com/boardgame/425445/sweet-lands) 與[中文版官方募資頁](https://www.zeczec.com/projects/SweetLands)：中文名稱及甜點王國建城主題一致。 |

已執行檔：`updates.sql`。每筆使用既有遊戲 ID，並限定目前仍為公開、未合併、缺少 BGG ID 的主遊戲；重複執行不會再寫入已補好的資料。操作前備份六筆原資料並以索引查證 BGG ID 沒有被其他遊戲使用；操作後逐欄確認只有 `bgg_id` 改變，且六款的屬性狀態均已初始化。

## 重複遊戲：已走既有合併流程

[Mountain Goats: Legacy](https://boardgamegeek.com/boardgame/460712/mountain-goats-legacy) 對應 BGG ID `460712`，但它已由另一筆公開主遊戲使用：

- 缺少 ID 的重複列：`game_047e8e6f174f4bb485e09f7689ae1602`，slug 為 `mountain-goats-legacy`。
- 保留的既有列：`game_bgg_460712`，slug 為 `bgg-460712`；`games.bgg_id` 與 `game_external_ids` 都已對應 `460712`。

不把這筆列入補填 SQL。`merge-request.json` 保留原請求內容；合併已透過與該 API 共用的 `mergeGames()` 執行，以保留規則、收藏、版本關係及正確的舊投票指向。原有一筆規則與投稿已移到保留列，25 筆目標屬性結果完全保留；來源沒有收藏或投票需要搬移。

## 最初只讀盤點的正式 D1 實際消耗

來源開始讀取時間：2026-10-30 19:40（Asia/Taipei）。完整原始結果與每次查詢 metadata 留在本機 `.wrangler/bgg-fill-20261030/source.json`；可提交的用量憑據為 `usage.json`。

| 只讀操作 | 回傳列數 | 實際讀取列數 | 實際寫入列數 |
| --- | ---: | ---: | ---: |
| 下載 `games` 必要欄位 | 311 | 311 | 0 |
| 查七款候選遊戲的既有外部 ID | 0 | 7 | 0 |
| 查七款候選遊戲的別名 | 1 | 106 | 0 |
| 以七個 BGG ID 反查外部對應，確認重複 | 1 | 8 | 0 |
| 合計 | — | **432** | **0** |

四次查詢的 `changed_db` 都是 `false`，`total_attempts` 都是 `1`。別名查詢雖只回傳一列，D1 規劃器實際掃描了 106 列，已完整列入用量，沒有把回傳筆數當成成本。

311 筆遊戲中共有 17 筆缺少主 BGG ID：本次處理其中七款公開主遊戲；另七筆為隱藏版本／擴充／標籤列，三筆已合併，均不納入這次的近期主遊戲補填。

上述 432 列只計最初的只讀盤點。後續合併與名稱修正另新增 6,071 列讀取、550 列寫入。

## 六款正式補填的實際用量

2026-10-30 22:10:25–22:10:35（Asia/Taipei），透過官方遠端 D1 binding，以同一個原生 batch 交易套用六筆已查證的 UPDATE，再呼叫已發布程式共用的 `flushCatalogOutbox()`，只處理到六筆屬性主題。沒有手動重播、重建快照或重新部署 Worker。

| 階段 | 實際讀取列數 | 實際寫入列數 |
| --- | ---: | ---: |
| 原資料備份與 BGG 對應衝突檢查 | 24 | 0 |
| 六筆 BGG 更新及既有 trigger | 1,044 | 1,272 |
| 六筆屬性增量發布 | 290 | 25 |
| 更新後逐欄比對及初始化核對 | 174 | 0 |
| 本輪合計 | **1,532** | **1,297** |

每款 UPDATE 實測讀取 174 列、寫入 212 列；成本包含既有的屬性初始化、索引及 outbox 更新，不把六筆遊戲欄位更新誤報成六列寫入。所有數字均來自 D1 metadata，包含 trigger 與索引的實際用量。

可提交的憑據為 `applied-usage.json`；原資料備份及逐條結果留在本機 `.wrangler/bgg-fill-20261030/applied.json`，不提交私人原始列。三輪正式資料操作合計 **8,035 列讀取、1,847 列寫入**；此合計不包含 Worker 部署前置檢查。
