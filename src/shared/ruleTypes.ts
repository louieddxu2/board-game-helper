

export const FLOW_STAGES = [
  'setup',
  'round',
  'action',
  'end_scoring',
  'edition_player_count',
  'always',
  'uncategorized',
] as const;

export type FlowStage = (typeof FLOW_STAGES)[number];

export const RULE_CATEGORIES = [
  'teaching_setup_opening',
  'action_effect_detail',
  'flow_endgame_scoring',
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  teaching_setup_opening: '教學、設置、開局',
  action_effect_detail: '行動、效果、細節',
  flow_endgame_scoring: '流程、終局、計分',
};

export type UserRole = 'admin' | 'editor';

export type ContributionReviewStatus = 'not_required' | 'pending' | 'reviewed';
