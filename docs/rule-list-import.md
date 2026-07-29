# Codex 規則清單匯入格式

這個格式用於把文章、規則書摘錄或整理結果帶進「記錄規則」頁。匯入只會覆寫本機草稿，不會直接寫入正式資料；使用者仍需逐條檢查並按下「儲存」。每檔最多 20 條、64 KB。

把文章交給 Codex 時，可以要求：

> 依照 `docs/rule-list-import.md`，把內容整理成 UTF-8 JSON。不可臆測原文沒有的規則；一句只表達一個可操作的規則。分類只可使用文件列出的三個值。

```json
{
  "format": "wrong-board-game-rules-draft",
  "schemaVersion": 1,
  "game": {
    "displayName": "遊戲中文名",
    "englishName": "English Name"
  },
  "sourceLabel": "官方規則書",
  "sourceUrl": "https://example.com/rules",
  "rules": [
    {
      "statement": "每回合開始時抽一張牌。",
      "commonMistake": "不是在回合結束時抽牌。",
      "categories": ["action_effect_detail"],
      "playerCounts": [2, 3, 4],
      "editionNotes": ["第二版"],
      "tagNames": ["手牌"]
    }
  ]
}
```

分類值只有：

- `teaching_setup_opening`：教學、設置、開局
- `action_effect_detail`：行動、效果、細節
- `flow_endgame_scoring`：流程、判定、計分

若已知網站內的既有遊戲，可在 `game` 同時提供 `id`、`slug`、`displayName`；`id` 與 `slug` 不可只提供其中一個。標籤只按正式名稱比對，不用別名猜測。編輯者遇到不存在的標籤時，匯入會停止並列出名稱；管理員可將它們作為新標籤帶入。
