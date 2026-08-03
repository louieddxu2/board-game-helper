# 規則草稿 JSON 匯入格式

本文件是「紀錄玩錯的規則」頁面管理員匯入 JSON 的 canonical contract。需要產生或修改匯入 JSON 時，先讀本文件；runtime 的最終驗證實作在 src/lib/ruleDraftImport.ts。

## 這份 JSON 的用途

這是編輯頁的規則草稿交換格式：

~~~text
JSON → parseRuleDraftImport() → AddPage RuleInput → IndexedDB active draft → SubmissionInput
~~~

匯入只會填入本機紀錄草稿。使用者仍需檢查內容並按下送出；送出時系統會自行產生新的 idempotencyKey。

這份格式不是：

- /api/submissions 的 API request。不要放 newGame、gameId 或 idempotencyKey。
- 管理員校稿匯出檔。校稿檔使用 wrong-board-game-rules-review、items、current、proposed，只能給校稿流程使用。

## 頂層格式

~~~json
{
  "format": "wrong-board-game-rules-draft",
  "schemaVersion": 2,
  "game": {
    "displayName": "遊戲名稱",
    "englishName": "English Name"
  },
  "sourceLabel": "官方說明書",
  "sourceUrl": "https://example.com/rules",
  "rules": []
}
~~~

### 頂層欄位

| 欄位 | 規則 |
| --- | --- |
| format | 固定為 wrong-board-game-rules-draft。 |
| schemaVersion | 新產生的 JSON 使用 2。目前仍可讀取舊版 1，讀入後會正規化成 v2。 |
| game | 必填。新遊戲只填 displayName／englishName；既有遊戲必須同時填 id 與 slug。不可只填其中一個。 |
| sourceLabel | 可選的整份草稿預設來源名稱；規則個別欄位可覆寫。 |
| sourceUrl | 可選的整份草稿預設來源網址；沒有網址時省略欄位，不要填空字串。 |
| rules | 必須有 1–20 筆。 |

整份 UTF-8 JSON 不得超過 64 KiB。

## 規則欄位

每筆 rules 可使用以下欄位。欄位名稱固定使用 camelCase，不要改成 snake_case 或自行翻譯。

| 欄位 | 規則 |
| --- | --- |
| statement | 必填字串，1–2000 字元；描述可執行的規則結論。 |
| commonMistake | 可選字串，最多 2000 字元。 |
| details | 可選補充說明，最多 5000 字元。 |
| flowStage | 可選；只能使用下方列出的流程值。 |
| categories | 可選；只能使用下方列出的分類值。 |
| playerCounts | 可選整數陣列，每個值 1–8，最多 8 個。 |
| editionNotes | 可選字串陣列，最多 20 個，每個最多 300 字元。 |
| sourceLabel | 可選規則個別來源名稱。 |
| sourceUrl | 可選規則個別來源網址；沒有網址時省略。 |
| tagNames | 可選標籤名稱陣列，最多 8 個；使用正式標籤名稱，不要填 tag id 或自行猜別名。 |

### flowStage 允許值

~~~text
setup
round
action
end_scoring
edition_player_count
always
uncategorized
~~~

### categories 允許值

~~~text
teaching_setup_opening
action_effect_detail
flow_endgame_scoring
~~~

rule_errata、faq_clarification、icon_effect 不是目前系統的合法 enum，不要放進 canonical JSON。若來源資料使用其他分類，先依規則內容轉換成上述值；無法可靠轉換時省略，不能臆造新值。

## 完整範例

~~~json
{
  "format": "wrong-board-game-rules-draft",
  "schemaVersion": 2,
  "game": {
    "displayName": "柏林咖啡館",
    "englishName": "Seize the Bean"
  },
  "rules": [
    {
      "statement": "使用急速運輸時，可以從自己的食品櫃升級牌中選擇兩個符號啟動。",
      "commonMistake": "認為兩個符號必須位於同一張食品櫃升級牌上。",
      "details": "兩個符號可以位於不同的升級牌上。",
      "flowStage": "action",
      "categories": ["action_effect_detail"],
      "sourceLabel": "英文說明書",
      "tagNames": ["急速運輸", "食品櫃升級牌"]
    },
    {
      "statement": "啟動公平交易時，不能支付生豆並換取生豆，藉此取得好評。",
      "details": "官方 FAQ 說明這不是原本的設計意圖。",
      "flowStage": "action",
      "categories": ["action_effect_detail"],
      "sourceLabel": "官方 FAQ",
      "sourceUrl": "https://example.com/faq"
    }
  ]
}
~~~

## AI 產生 JSON 的規則

1. 先確認輸出是本文件的草稿格式，不是 API submission 或 review export。
2. 固定輸出 format、schemaVersion: 2、game、rules。
3. 只使用本文件列出的欄位與 enum；不要把來源資料中的分類名稱原樣塞入 categories。
4. 沒有值就省略可選欄位，尤其是 sourceUrl，不要使用空字串或 null。
5. 不要加入 idempotencyKey；這是送出 API 的傳輸欄位，由網站產生。
6. 不要把 game 改成 newGame。新遊戲用沒有 id／slug 的 game 表示。
7. 不可根據原文沒有的內容補寫規則、來源、分類或標籤。

## 相關程式位置

- Parser／runtime schema：src/lib/ruleDraftImport.ts
- 紀錄頁匯入與送出：src/pages/AddPage.tsx
- 本機草稿型別與 IndexedDB：src/lib/localDb.ts
- 共用 enum：src/shared/types.ts 的 FLOW_STAGES、RULE_CATEGORIES
- 校稿 JSON 的另一套格式：docs/review-workflow.md
