-- Attribute comparison subject layer. Existing games/rules semantics remain unchanged.
CREATE TABLE attribute_subjects (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('game', 'configuration')),
  display_name TEXT NOT NULL, game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_attribute_subjects_game ON attribute_subjects(game_id);
CREATE INDEX idx_attribute_subjects_kind_name ON attribute_subjects(kind, display_name, id);

CREATE TABLE attribute_subject_components (
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  component_order INTEGER NOT NULL, game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  component_type TEXT NOT NULL CHECK (component_type IN ('base', 'expansion', 'label')),
  label TEXT NOT NULL, PRIMARY KEY (subject_id, component_order)
);
CREATE INDEX idx_attribute_subject_components_game ON attribute_subject_components(game_id);

CREATE TABLE attributes (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, category TEXT,
  min_value INTEGER NOT NULL DEFAULT 0, max_value INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL
);
CREATE TABLE attribute_translations (
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  locale TEXT NOT NULL, name TEXT NOT NULL, short_description TEXT, full_description TEXT,
  PRIMARY KEY (attribute_id, locale)
);
CREATE TABLE attribute_ratings (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value >= 0 AND value <= 10), actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (session_id, subject_id, attribute_id)
);
CREATE INDEX idx_attribute_ratings_subject_attribute ON attribute_ratings(subject_id, attribute_id, updated_at DESC);
CREATE INDEX idx_attribute_ratings_attribute_subject ON attribute_ratings(attribute_id, subject_id, updated_at DESC);

CREATE TABLE attribute_comparisons (
  id TEXT PRIMARY KEY, attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  subject_a_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('A_HIGHER', 'SIMILAR', 'B_HIGHER')),
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK (subject_a_id <> subject_b_id),
  UNIQUE (session_id, attribute_id, subject_a_id, subject_b_id)
);
CREATE INDEX idx_attribute_comparisons_pair ON attribute_comparisons(subject_a_id, subject_b_id, attribute_id, updated_at DESC);

CREATE TABLE attribute_import_candidates (
  id TEXT PRIMARY KEY, source_name TEXT NOT NULL, values_json TEXT NOT NULL,
  source_spreadsheet_id TEXT NOT NULL, source_sheet_name TEXT NOT NULL, source_row_number INTEGER NOT NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('pending', 'matched', 'ambiguous', 'skipped')),
  subject_id TEXT REFERENCES attribute_subjects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_attribute_import_candidates_status ON attribute_import_candidates(match_status, source_name, source_row_number);

INSERT INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
SELECT 'attribute_subject_game:' || g.id, 'game-' || g.slug, 'game', g.display_name, g.id, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games g WHERE g.merged_into_game_id IS NULL;
INSERT INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
SELECT s.id, 0, s.game_id, 'base', s.display_name FROM attribute_subjects s
WHERE s.kind = 'game' AND s.game_id IS NOT NULL;

CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
END;
CREATE TRIGGER attribute_subject_games_after_update AFTER UPDATE OF display_name, merged_into_game_id ON games
BEGIN
  UPDATE attribute_subjects SET display_name = NEW.display_name, updated_at = NEW.updated_at WHERE game_id = NEW.id AND kind = 'game';
  UPDATE attribute_subject_components SET label = NEW.display_name WHERE game_id = NEW.id AND component_type = 'base';
END;

INSERT INTO attributes (id, key, category, min_value, max_value, is_active, sort_order) VALUES
('attribute_mechanism_uniqueness', 'mechanism_uniqueness', NULL, 0, 10, 1, 0),
('attribute_systemic_coherence', 'systemic_coherence', NULL, 0, 10, 1, 1),
('attribute_cooperation', 'cooperation', NULL, 0, 10, 1, 2),
('attribute_worker_placement', 'worker_placement', NULL, 0, 10, 1, 3),
('attribute_luck', 'luck', NULL, 0, 10, 1, 4),
('attribute_adaptability', 'adaptability', NULL, 0, 10, 1, 5),
('attribute_long_term_planning', 'long_term_planning', NULL, 0, 10, 1, 6),
('attribute_setup_variability', 'setup_variability', NULL, 0, 10, 1, 7),
('attribute_numeric_calculation', 'numeric_calculation', NULL, 0, 10, 1, 8),
('attribute_process_calculation', 'process_calculation', NULL, 0, 10, 1, 9),
('attribute_interaction_calculation', 'interaction_calculation', NULL, 0, 10, 1, 10),
('attribute_thematic_integration', 'thematic_integration', NULL, 0, 10, 1, 11),
('attribute_score_race', 'score_race', NULL, 0, 10, 1, 12),
('attribute_end_condition', 'end_condition', NULL, 0, 10, 1, 13),
('attribute_personal_puzzle', 'personal_puzzle', NULL, 0, 10, 1, 14),
('attribute_shared_puzzle', 'shared_puzzle', NULL, 0, 10, 1, 15),
('attribute_shared_environment', 'shared_environment', NULL, 0, 10, 1, 16),
('attribute_strategic_abstraction', 'strategic_abstraction', NULL, 0, 10, 1, 17),
('attribute_engine_building', 'engine_building', NULL, 0, 10, 1, 18),
('attribute_hidden_information', 'hidden_information', NULL, 0, 10, 1, 19),
('attribute_prior_information', 'prior_information', NULL, 0, 10, 1, 20),
('attribute_logical_deduction', 'logical_deduction', NULL, 0, 10, 1, 21),
('attribute_intentional_inference', 'intentional_inference', NULL, 0, 10, 1, 22),
('attribute_waiting_for_actions', 'waiting_for_actions', NULL, 0, 10, 1, 23),
('attribute_waiting_for_thinking', 'waiting_for_thinking', NULL, 0, 10, 1, 24),
('attribute_real_time_reaction', 'real_time_reaction', NULL, 0, 10, 1, 25);

INSERT INTO attribute_translations (attribute_id, locale, name, short_description, full_description) VALUES
('attribute_mechanism_uniqueness', 'zh-TW', '機制獨特', NULL, '有很難在其他遊戲中看到的機制'),
('attribute_systemic_coherence', 'zh-TW', '整體感', NULL, '遊戲中多種機制彼此之間相輔相成為一整體的感受，而非多種小遊戲。'),
('attribute_cooperation', 'zh-TW', '合作成分', NULL, '遊戲中玩家與玩家間會合作/可合作增加彼此的勝率。'),
('attribute_worker_placement', 'zh-TW', '機制／工人放置', NULL, '一個行動被某位玩家執行了以後，其他玩家就暫時不能執行，或者需付出額外代價才能執行。'),
('attribute_luck', 'zh-TW', '運氣成分', NULL, '遊戲過程中由抽牌、擲骰或其他機率性的方式決定事物。'),
('attribute_adaptability', 'zh-TW', '隨機應變', NULL, '遊戲過程中需根據隨機事件、其他玩家的行為即時調整自己要做的事情。'),
('attribute_long_term_planning', 'zh-TW', '長期規劃', NULL, '遊戲中一般而言能規劃多久以後要做的事情而無關隨機應變，最遠至遊戲結束時。'),
('attribute_setup_variability', 'zh-TW', '設置變化', NULL, '遊戲開始前場上的設置變化性，包含玩家起始拿到的手牌，即在玩家做出第一個決定以前的變化性。'),
('attribute_numeric_calculation', 'zh-TW', '數字計算', NULL, '數字的四則運算。'),
('attribute_process_calculation', 'zh-TW', '流程計算', NULL, '先做什麼後做什麼的流程圖規劃。'),
('attribute_interaction_calculation', 'zh-TW', '互動計算', NULL, '別人做什麼我要做什麼，我做什麼別人會做什麼的賽局樹狀圖思考。'),
('attribute_thematic_integration', 'zh-TW', '融入情境', NULL, '玩起來的感覺有多像遊戲提供的故事的感受。'),
('attribute_score_race', 'zh-TW', '得分取勝', NULL, '需要在遊戲過程中不斷不斷地增加分數，以至於最後總分最高取勝。'),
('attribute_end_condition', 'zh-TW', '條件取勝', NULL, '遊戲有多容易在一個情況發生時突如其然地結束。玩家有多容易在觀察到特定情況時可以直接體面退出遊戲。'),
('attribute_personal_puzzle', 'zh-TW', '個人拼圖', NULL, '個人自己的，包含形狀拼圖，或拼圖上有意義不同的東西，放置在不同位置會有影響的拼圖結構。'),
('attribute_shared_puzzle', 'zh-TW', '公共拼圖', NULL, '玩家們一同影響共同地方的拼圖結構。'),
('attribute_shared_environment', 'zh-TW', '公共環境', NULL, '玩家們會改變共有環境的設置狀態。'),
('attribute_strategic_abstraction', 'zh-TW', '策略／抽象', NULL, '思考策略時有多麼抽離遊戲本身的情境。'),
('attribute_engine_building', 'zh-TW', '策略／建立引擎', NULL, '玩家思考策略的核心是建立自身的引擎去面對遊戲給予的情境，或用這個引擎與其他玩家互動。'),
('attribute_hidden_information', 'zh-TW', '隱藏資訊', NULL, '玩家彼此之間有人知道有人不知道的資訊量。'),
('attribute_prior_information', 'zh-TW', '先備資訊', NULL, '玩家在遊戲過程中可由過往在遊戲經驗中獲知的隨機資訊（如知道牌庫裡牌的數量占比），進而影響自身決策的程度。'),
('attribute_logical_deduction', 'zh-TW', '邏輯推理', NULL, '遊戲中含有可被玩家在遊戲過程中嚴格推理得知的未知資訊，若推敲出來即獲勝或很大機率取勝。'),
('attribute_intentional_inference', 'zh-TW', '意向推理', NULL, '玩家在遊戲中需透過他人選擇的意向性去推敲對自己而言被隱藏的資訊，進而增加獲勝機率。'),
('attribute_waiting_for_actions', 'zh-TW', '等待他人行動', NULL, '遊戲中已經做完行動的玩家須等待其他玩家做完行動。'),
('attribute_waiting_for_thinking', 'zh-TW', '等待他人思考', NULL, '必須等待其他玩家思考完，自己才能思考。'),
('attribute_real_time_reaction', 'zh-TW', '即時反應', NULL, '遊戲有真實時間限制，或真實時間的競速機制。');

INSERT INTO attribute_import_candidates
  (id, source_name, values_json, source_spreadsheet_id, source_sheet_name, source_row_number, match_status, subject_id, created_at, updated_at)
VALUES
('attribute_candidate:3', '花磚物語Azul', '[10,8,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 3, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:4', '聖瑪利亞號+美洲大陸擴充', '[8,7,null,0,8,6,9,10,8,10,2,8,8,0,10,0,0,5,10,2,6,0,1,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 4, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:5', '疊人塔', '[10,9,null,0,6,9,6,7,3,7,8,9,10,0,10,0,0,9,4,0,3,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 5, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:6', '聖瑪利亞號', '[8,8,1,0,7,7,8,9,7,9,2,7,8,0,9,0,0,5,9,0,5,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 6, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:7', '格蘭摩爾2', '[7,8,null,0,9,9,4,9,2,5,2,6,10,0,9,0,3,7,10,0,10,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 7, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:8', '熊熊公園+灰熊大進擊擴充', '[4,9,null,0,1,4,6,7,7,7,3,7,10,0,9,0,0,3,0,0,0,0,0,null,4,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 8, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:9', '暖秋物語Indian Summer', '[10,10,null,0,0,5,3,null,null,null,null,1,null,1,9,null,null,null,null,null,null,null,null,null,4,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 9, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:10', 'Spring Meadow', '[9,9,null,0,0,4,6,null,null,null,null,3,null,3,9,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 10, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:11', '五月花號', '[8,8,5,7,7,9,8,7,null,null,10,null,null,null,8,null,8,6,5,4,8,0,2,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 11, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:12', '熊熊公園', '[3,10,null,0,1,3,7,6,3,6,2,9,10,0,8,0,0,4,0,0,0,0,0,null,3,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 12, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:13', '五月花流Keyflow', '[2,9,4,6,10,7,9,10,null,null,5,null,null,null,7,null,7,8,5,4,9,0,2,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 13, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:14', '拼布藝術', '[7,10,0,0,0,7,9,8,5,8,10,10,6,3,7,0,null,null,null,null,null,null,null,null,5,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 14, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:15', '花舍物語Cottage Garden', '[8,7,null,0,0,3,5,null,null,null,null,2,null,0,7,null,null,null,null,null,null,null,null,null,3,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 15, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:16', '奧丁的盛宴+挪威擴充', '[7,7,null,10,5,null,null,4,4,9,7,9,6,0,6,0,0,2,9,2,5,0,2,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 16, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:17', '奧丁的盛宴', '[7,6,null,9,5,null,null,3,3,8,6,8,7,0,5,0,0,3,8,2,5,0,1,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 17, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:18', '農家樂', '[6,9,3,10,4,8,7,10,3,7,8,9,6,4,3,1,2,4,9,7,10,0,6,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 18, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:19', '彩色島', '[8,2,null,0,4,8,null,null,null,8,3,3,9,0,3,7,9,9,7,null,3,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 19, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:20', '牛頓', '[7,3,0,0,1,2,10,8,9,5,1,5,9,0,1,0,1,1,8,2,5,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 20, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:21', '魔幻傳奇/+學院擴充', '[7,9,5,8,4,8,5,1,6,8,8,10,6,2,1,2,2,2,9,6,9,0,4,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 21, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:22', '亞勒大地', '[7,9,0,10,0,6,8,5,2,10,6,9,10,0,1,0,0,1,8,0,0,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 22, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:23', '馬雅曆法', '[10,5,2,9,1,5,7,2,4,7,7,2,7,0,0,0,1,6,9,0,3,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 23, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:24', '馬雅曆法+部落與預言擴充', '[10,6,2,9,2,6,8,5,5,8,8,3,7,0,0,0,1,6,9,1,4,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 24, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:25', '快餐連鎖店', '[8,10,1,0,0,9,6,3,4,8,10,10,3,8,0,9,10,7,10,0,0,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 25, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:26', '快餐連鎖店+Ketchup擴充', '[9,10,2,0,0,9,6,4,5,8,10,9,5,7,0,9,10,8,10,0,0,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 26, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:27', '圖拉真', '[9,2,0,0,5,4,9,3,3,9,2,1,4,0,0,2,2,9,6,0,2,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 27, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:28', '聖托里尼', '[9,10,0,0,0,10,5,1,1,10,10,3,0,10,0,10,10,10,0,0,0,0,0,1,1,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 28, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:29', '天際線Skyliners', '[9,9,5,0,0,9,3,2,2,3,9,6,0,9,0,10,10,5,0,9,0,0,8,null,8,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 29, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:30', '生態圈Ecos:First Continent', '[10,3,3,0,9,7,4,5,3,5,7,5,10,1,0,10,10,8,4,8,10,0,2,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 30, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:31', '羊羊危機', '[8,2,6,0,0,10,1,null,2,3,10,3,9,1,0,10,10,9,0,0,0,0,0,null,2,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 31, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:32', '馬可波羅', '[7,7,0,8,7,9,6,9,8,9,9,8,8,0,0,0,0,3,7,2,2,0,3,null,4,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 32, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:33', '馬可波羅+威尼斯擴充', '[6,6,0,7,8,7,9,10,9,6,4,7,9,0,0,0,0,4,8,2,3,0,2,null,1,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 33, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:34', '馬可波羅2', '[6,9,1,8,7,9,8,9,null,9,9,9,9,0,0,0,0,2,8,2,6,0,3,null,1,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 34, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:35', '大西部之旅/+一路向北擴充', '[6,10,2,0,5,7,7,8,3,9,8,8,9,0,0,null,9,4,9,5,2,0,3,null,5,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 35, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:36', '馬拉開波', '[5,10,0,0,8,9,7,10,4,9,6,5,10,0,0,null,8,5,10,6,7,0,1,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 36, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:37', '蓋亞計劃', '[7,10,4,0,0,9,4,8,3,10,9,8,9,0,0,null,9,3,8,0,0,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 37, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:38', 'Fog of love', '[2,6,7,0,9,7,6,9,2,1,9,10,0,0,0,0,1,3,0,10,8,1,9,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 38, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:39', 'And then, we hold hands', '[9,2,10,0,9,10,7,2,null,10,10,2,0,0,0,0,10,8,0,0,0,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 39, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:40', '第七大陸/+有起必有落擴充', '[6,8,10,0,8,null,null,0,5,10,0,10,0,0,0,0,10,3,9,1,10,0,1,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 40, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:41', '和薩同盟', '[5,9,6,0,0,10,4,3,null,7,9,3,7,0,0,0,10,10,9,0,0,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 41, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:42', '和諧羅馬', '[5,9,null,0,3,10,5,7,10,10,9,5,8,0,0,0,9,9,9,2,7,0,0,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 42, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:43', '心靈同步', '[10,10,10,0,0,10,10,7,1,1,10,10,0,0,0,0,0,0,0,10,0,1,10,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 43, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:44', '花火', '[9,10,10,0,7,9,2,7,0,3,10,3,10,3,0,0,0,9,0,5,0,7,10,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 44, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:45', '不速之客', '[9,10,4,0,8,5,1,10,null,null,4,5,0,10,0,0,0,3,0,6,5,8,2,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 45, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:46', '本草', '[10,10,4,0,0,9,2,6,null,null,2,1,1,10,0,0,0,10,0,8,0,9,7,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 46, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:47', '神祕生物', '[9,10,6,0,0,4,3,10,null,null,1,2,0,10,0,0,0,10,0,10,0,10,5,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 47, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:48', '新月任務Nova Luna', '[8,9,2,0,9,4,3,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,9,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 48, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:49', '水果莊園', '[null,10,2,null,null,null,5,5,null,null,null,9,null,null,null,null,null,null,null,null,null,null,null,null,8,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 49, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:50', '柑橘園物語Citrus', '[null,null,null,null,null,null,null,null,null,null,null,7,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 50, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:51', '花見小路', '[10,10,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,10,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 51, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:52', '步兵的恐懼', '[null,10,10,null,null,null,null,null,null,null,null,10,null,3,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 52, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:53', '花磚物語Azul', '[10,8,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 53, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:54', '花磚物語:琉璃之光', '[8,6,null,null,null,null,null,null,null,null,null,2,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 54, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:55', '花磚物語:夏日行宮', '[9,7,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 55, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:56', '鐵路墨軌Railroad Ink', '[5,6,0,0,10,10,0,0,null,null,null,10,null,null,null,null,null,null,null,8,null,null,null,3,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 56, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:57', '鐵路墨軌：挑戰
Railroad Ink:Challenge', '[4,5,0,0,10,10,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 57, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:58', '修剪藝術Topiary', '[8,5,1,null,null,null,null,null,null,null,null,9,null,null,null,null,null,null,null,4,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 58, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:59', '天堂與麥酒', '[8,null,0,null,null,null,null,3,null,null,null,5,null,2,null,null,null,null,null,0,null,null,null,null,6,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 59, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:60', '展翅翱翔', '[3,null,0,null,null,null,null,null,null,null,null,8,null,null,null,null,null,null,null,3,null,null,null,null,2,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 60, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:61', '水壩+利格沃特擴充', '[10,9,4,10,null,null,null,7,null,null,null,10,null,6,null,null,null,null,null,0,6,null,null,null,9,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 61, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:62', '西國聖騎士', '[6,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,9,1,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 62, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:63', '多米諾王國', '[7,10,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 63, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:64', '多米諾女王', '[6,8,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 64, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:65', 'QE', '[10,10,5,0,1,10,1,0,null,null,null,null,null,null,null,null,null,null,null,8,1,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 65, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:66', 'Lovelace & Barbbage', '[8,3,null,1,4,10,1,0,10,7,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,9]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 66, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:67', '華麗開演', '[6,7,null,0,8,7,6,null,null,null,null,null,null,null,null,null,null,null,null,0,7,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 67, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
('attribute_candidate:68', '貓島', '[4,9,null,0,9,9,3,null,null,null,null,null,null,null,null,null,null,null,null,9,9,null,null,null,null,null]', '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c', '工作表1', 68, 'pending', NULL, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER));

UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_ece22ff7f8cc887f560d', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 6 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_ece22ff7f8cc887f560d');
UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 7 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3');
UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_3b77f7f4b22d03184c5b', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 12 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_3b77f7f4b22d03184c5b');
UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_bba34ef47e1dccb322e3', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 27 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_bba34ef47e1dccb322e3');
UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_89d06dbb36089642bcc1', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 59 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_89d06dbb36089642bcc1');
UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_b9d5d8eaf27e55734042', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 65 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_b9d5d8eaf27e55734042');
UPDATE attribute_import_candidates SET match_status = 'matched', subject_id = 'attribute_subject_game:game_f6111657f5ff4844ffd4', updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE source_row_number = 67 AND source_spreadsheet_id = '1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c'
  AND EXISTS (SELECT 1 FROM attribute_subjects WHERE id = 'attribute_subject_game:game_f6111657f5ff4844ffd4');

WITH seed(id, subject_id, attribute_id, value) AS (
  VALUES
('attribute_rating_seed:6:mechanism_uniqueness', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_mechanism_uniqueness', 8),
('attribute_rating_seed:6:systemic_coherence', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_systemic_coherence', 8),
('attribute_rating_seed:6:cooperation', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_cooperation', 1),
('attribute_rating_seed:6:worker_placement', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_worker_placement', 0),
('attribute_rating_seed:6:luck', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_luck', 7),
('attribute_rating_seed:6:adaptability', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_adaptability', 7),
('attribute_rating_seed:6:long_term_planning', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_long_term_planning', 8),
('attribute_rating_seed:6:setup_variability', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_setup_variability', 9),
('attribute_rating_seed:6:numeric_calculation', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_numeric_calculation', 7),
('attribute_rating_seed:6:process_calculation', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_process_calculation', 9),
('attribute_rating_seed:6:interaction_calculation', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_interaction_calculation', 2),
('attribute_rating_seed:6:thematic_integration', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_thematic_integration', 7),
('attribute_rating_seed:6:score_race', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_score_race', 8),
('attribute_rating_seed:6:end_condition', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_end_condition', 0),
('attribute_rating_seed:6:personal_puzzle', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_personal_puzzle', 9),
('attribute_rating_seed:6:shared_puzzle', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_shared_puzzle', 0),
('attribute_rating_seed:6:shared_environment', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_shared_environment', 0),
('attribute_rating_seed:6:strategic_abstraction', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_strategic_abstraction', 5),
('attribute_rating_seed:6:engine_building', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_engine_building', 9),
('attribute_rating_seed:6:hidden_information', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_hidden_information', 0),
('attribute_rating_seed:6:prior_information', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_prior_information', 5),
('attribute_rating_seed:6:logical_deduction', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_logical_deduction', 0),
('attribute_rating_seed:6:intentional_inference', 'attribute_subject_game:game_ece22ff7f8cc887f560d', 'attribute_intentional_inference', 0),
('attribute_rating_seed:7:mechanism_uniqueness', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_mechanism_uniqueness', 7),
('attribute_rating_seed:7:systemic_coherence', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_systemic_coherence', 8),
('attribute_rating_seed:7:worker_placement', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_worker_placement', 0),
('attribute_rating_seed:7:luck', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_luck', 9),
('attribute_rating_seed:7:adaptability', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_adaptability', 9),
('attribute_rating_seed:7:long_term_planning', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_long_term_planning', 4),
('attribute_rating_seed:7:setup_variability', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_setup_variability', 9),
('attribute_rating_seed:7:numeric_calculation', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_numeric_calculation', 2),
('attribute_rating_seed:7:process_calculation', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_process_calculation', 5),
('attribute_rating_seed:7:interaction_calculation', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_interaction_calculation', 2),
('attribute_rating_seed:7:thematic_integration', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_thematic_integration', 6),
('attribute_rating_seed:7:score_race', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_score_race', 10),
('attribute_rating_seed:7:end_condition', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_end_condition', 0),
('attribute_rating_seed:7:personal_puzzle', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_personal_puzzle', 9),
('attribute_rating_seed:7:shared_puzzle', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_shared_puzzle', 0),
('attribute_rating_seed:7:shared_environment', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_shared_environment', 3),
('attribute_rating_seed:7:strategic_abstraction', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_strategic_abstraction', 7),
('attribute_rating_seed:7:engine_building', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_engine_building', 10),
('attribute_rating_seed:7:hidden_information', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_hidden_information', 0),
('attribute_rating_seed:7:prior_information', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_prior_information', 10),
('attribute_rating_seed:7:logical_deduction', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_logical_deduction', 0),
('attribute_rating_seed:7:intentional_inference', 'attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 'attribute_intentional_inference', 0),
('attribute_rating_seed:12:mechanism_uniqueness', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_mechanism_uniqueness', 3),
('attribute_rating_seed:12:systemic_coherence', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_systemic_coherence', 10),
('attribute_rating_seed:12:worker_placement', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_worker_placement', 0),
('attribute_rating_seed:12:luck', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_luck', 1),
('attribute_rating_seed:12:adaptability', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_adaptability', 3),
('attribute_rating_seed:12:long_term_planning', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_long_term_planning', 7),
('attribute_rating_seed:12:setup_variability', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_setup_variability', 6),
('attribute_rating_seed:12:numeric_calculation', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_numeric_calculation', 3),
('attribute_rating_seed:12:process_calculation', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_process_calculation', 6),
('attribute_rating_seed:12:interaction_calculation', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_interaction_calculation', 2),
('attribute_rating_seed:12:thematic_integration', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_thematic_integration', 9),
('attribute_rating_seed:12:score_race', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_score_race', 10),
('attribute_rating_seed:12:end_condition', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_end_condition', 0),
('attribute_rating_seed:12:personal_puzzle', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_personal_puzzle', 8),
('attribute_rating_seed:12:shared_puzzle', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_shared_puzzle', 0),
('attribute_rating_seed:12:shared_environment', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_shared_environment', 0),
('attribute_rating_seed:12:strategic_abstraction', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_strategic_abstraction', 4),
('attribute_rating_seed:12:engine_building', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_engine_building', 0),
('attribute_rating_seed:12:hidden_information', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_hidden_information', 0),
('attribute_rating_seed:12:prior_information', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_prior_information', 0),
('attribute_rating_seed:12:logical_deduction', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_logical_deduction', 0),
('attribute_rating_seed:12:intentional_inference', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_intentional_inference', 0),
('attribute_rating_seed:12:waiting_for_thinking', 'attribute_subject_game:game_3b77f7f4b22d03184c5b', 'attribute_waiting_for_thinking', 3),
('attribute_rating_seed:27:mechanism_uniqueness', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_mechanism_uniqueness', 9),
('attribute_rating_seed:27:systemic_coherence', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_systemic_coherence', 2),
('attribute_rating_seed:27:cooperation', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_cooperation', 0),
('attribute_rating_seed:27:worker_placement', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_worker_placement', 0),
('attribute_rating_seed:27:luck', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_luck', 5),
('attribute_rating_seed:27:adaptability', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_adaptability', 4),
('attribute_rating_seed:27:long_term_planning', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_long_term_planning', 9),
('attribute_rating_seed:27:setup_variability', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_setup_variability', 3),
('attribute_rating_seed:27:numeric_calculation', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_numeric_calculation', 3),
('attribute_rating_seed:27:process_calculation', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_process_calculation', 9),
('attribute_rating_seed:27:interaction_calculation', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_interaction_calculation', 2),
('attribute_rating_seed:27:thematic_integration', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_thematic_integration', 1),
('attribute_rating_seed:27:score_race', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_score_race', 4),
('attribute_rating_seed:27:end_condition', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_end_condition', 0),
('attribute_rating_seed:27:personal_puzzle', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_personal_puzzle', 0),
('attribute_rating_seed:27:shared_puzzle', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_shared_puzzle', 2),
('attribute_rating_seed:27:shared_environment', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_shared_environment', 2),
('attribute_rating_seed:27:strategic_abstraction', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_strategic_abstraction', 9),
('attribute_rating_seed:27:engine_building', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_engine_building', 6),
('attribute_rating_seed:27:hidden_information', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_hidden_information', 0),
('attribute_rating_seed:27:prior_information', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_prior_information', 2),
('attribute_rating_seed:27:logical_deduction', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_logical_deduction', 0),
('attribute_rating_seed:27:intentional_inference', 'attribute_subject_game:game_bba34ef47e1dccb322e3', 'attribute_intentional_inference', 0),
('attribute_rating_seed:59:mechanism_uniqueness', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_mechanism_uniqueness', 8),
('attribute_rating_seed:59:cooperation', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_cooperation', 0),
('attribute_rating_seed:59:setup_variability', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_setup_variability', 3),
('attribute_rating_seed:59:thematic_integration', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_thematic_integration', 5),
('attribute_rating_seed:59:end_condition', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_end_condition', 2),
('attribute_rating_seed:59:hidden_information', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_hidden_information', 0),
('attribute_rating_seed:59:waiting_for_thinking', 'attribute_subject_game:game_89d06dbb36089642bcc1', 'attribute_waiting_for_thinking', 6),
('attribute_rating_seed:65:mechanism_uniqueness', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_mechanism_uniqueness', 10),
('attribute_rating_seed:65:systemic_coherence', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_systemic_coherence', 10),
('attribute_rating_seed:65:cooperation', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_cooperation', 5),
('attribute_rating_seed:65:worker_placement', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_worker_placement', 0),
('attribute_rating_seed:65:luck', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_luck', 1),
('attribute_rating_seed:65:adaptability', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_adaptability', 10),
('attribute_rating_seed:65:long_term_planning', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_long_term_planning', 1),
('attribute_rating_seed:65:setup_variability', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_setup_variability', 0),
('attribute_rating_seed:65:hidden_information', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_hidden_information', 8),
('attribute_rating_seed:65:prior_information', 'attribute_subject_game:game_b9d5d8eaf27e55734042', 'attribute_prior_information', 1),
('attribute_rating_seed:67:mechanism_uniqueness', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_mechanism_uniqueness', 6),
('attribute_rating_seed:67:systemic_coherence', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_systemic_coherence', 7),
('attribute_rating_seed:67:worker_placement', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_worker_placement', 0),
('attribute_rating_seed:67:luck', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_luck', 8),
('attribute_rating_seed:67:adaptability', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_adaptability', 7),
('attribute_rating_seed:67:long_term_planning', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_long_term_planning', 6),
('attribute_rating_seed:67:hidden_information', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_hidden_information', 0),
('attribute_rating_seed:67:prior_information', 'attribute_subject_game:game_f6111657f5ff4844ffd4', 'attribute_prior_information', 7)
)
INSERT OR IGNORE INTO attribute_ratings
  (id, subject_id, attribute_id, value, actor_id, session_id, created_at, updated_at)
SELECT id, subject_id, attribute_id, value, NULL, 'seed:google-sheet:1dtQPLMqQXpFWXJlvjVgCu7E8wJBY60XVVvW_tQx8g1c:v1', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM seed WHERE EXISTS (SELECT 1 FROM attribute_subjects WHERE attribute_subjects.id = seed.subject_id);

