import { describe, expect, test } from 'vitest';
import { toRule, type RuleRow } from './routes/shared';

const reviewedRule: RuleRow = {
  id: 'rule-1',
  game_id: 'game-1',
  statement: '正確規則',
  common_mistake: null,
  details: null,
  flow_stage: 'uncategorized',
  categories_json: '[]',
  player_counts_json: '[]',
  edition_notes_json: '[]',
  edition_note: null,
  status: 'published',
  created_by: null,
  created_at: 1,
  updated_at: 1,
  editor_ids_json: '[]',
  importance_count: 0,
  tag_ids_json: '[]',
  review_status: 'reviewed',
  reviewed_by: 'reviewer-1',
  reviewed_by_nickname: '審核當時暱稱',
  reviewed_at: 1,
};

describe('public reviewer nicknames', () => {
  test('hides a stored review nickname after the reviewer disables public display', () => {
    expect(toRule(reviewedRule).reviewedByNickname).toBeUndefined();
  });

  test('shows the stored review nickname while the reviewer allows public display', () => {
    const nicknameMap = new Map([['reviewer-1', '目前暱稱']]);
    expect(toRule(reviewedRule, new Map(), nicknameMap).reviewedByNickname).toBe('審核當時暱稱');
  });
});
