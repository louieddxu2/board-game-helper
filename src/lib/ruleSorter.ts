import type { RuleCard } from '../shared/types';

export type UniversalCategory =
  | 'highlight'   // 1. 重點警示 (Featured / Common Mistakes)
  | 'setup'       // 2. 設置與準備 (Setup & Preparation)
  | 'gameplay'    // 3. 流程與機制 (Gameplay & Mechanics)
  | 'scoring'     // 4. 結算與勝負 (Scoring & End Game)
  | 'general';    // 5. 一般規則 (General)

export interface CategoryGroup {
  id: UniversalCategory;
  title: string;
  icon: string;
  rules: RuleCard[];
}

const UNIVERSAL_SETUP_KEYWORDS = ['setup', '設置', '準備', '起始', '設定', '發牌', '初始'];
const UNIVERSAL_SCORING_KEYWORDS = ['scoring', '計分', '結算', '終局', '平手', '勝負', '得分'];

/**
 * 萬用規則分類判定
 */
export const classifyRuleUniversally = (rule: RuleCard): UniversalCategory => {
  // 1. 客觀特徵：優先抽離重點警示或含有常見錯法的規則 ➔ 【重點警示區】
  if (rule.commonMistake && rule.commonMistake.trim().length > 0) {
    return 'highlight';
  }

  const allTagNames = rule.tags.map((t) => t.name.toLocaleLowerCase());

  // 2. 萬用生命週期：設置類 ➔ 【設置與準備區】
  if (allTagNames.some((tag) => UNIVERSAL_SETUP_KEYWORDS.some((kw) => tag.includes(kw)))) {
    return 'setup';
  }

  // 3. 萬用生命週期：結算類 ➔ 【結算與勝負區】
  if (allTagNames.some((tag) => UNIVERSAL_SCORING_KEYWORDS.some((kw) => tag.includes(kw)))) {
    return 'scoring';
  }

  // 4. 流程與機制類
  return rule.tags.length > 0 ? 'gameplay' : 'general';
};

/**
 * 將遊戲規則聚合為 5 大萬用結構化分組
 */
export const groupRulesUniversally = (rules: RuleCard[]): CategoryGroup[] => {
  const map: Record<UniversalCategory, RuleCard[]> = {
    highlight: [],
    setup: [],
    gameplay: [],
    scoring: [],
    general: [],
  };

  rules.forEach((rule) => {
    const category = classifyRuleUniversally(rule);
    map[category].push(rule);
  });

  const categoryMeta: Array<{ id: UniversalCategory; title: string; icon: string }> = [
    { id: 'highlight', title: '重點避坑警示', icon: '⚠️' },
    { id: 'setup', title: '設置與準備', icon: '⚙️' },
    { id: 'gameplay', title: '流程與機制', icon: '🎮' },
    { id: 'scoring', title: '結算與勝負', icon: '🏆' },
    { id: 'general', title: '其他規則', icon: '📌' },
  ];

  return categoryMeta
    .map((meta) => ({
      ...meta,
      rules: map[meta.id],
    }))
    .filter((group) => group.rules.length > 0);
};
