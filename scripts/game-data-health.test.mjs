import { describe, expect, test } from 'vitest';
import { analyzeGameData, HEALTH_QUERIES, hasInvariantFailures } from './game-data-health.mjs';

const game = (id, displayName, extra = {}) => ({
  id, slug: id, display_name: displayName, english_name: null, normalized_name: displayName.toLowerCase().replace(/[\s:]/g, ''),
  bgg_id: null, merged_into_game_id: null, visibility: 'public', entity_kind: 'base', published_rule_count: 0, ...extra,
});

describe('game data health check', () => {
  test('only reads with two unfiltered selects', () => {
    Object.values(HEALTH_QUERIES).forEach((sql) => expect(sql).toMatch(/^SELECT [^;]+ FROM \w+$/));
  });

  test('queues public base games missing a BGG ID, most-used first', () => {
    const report = analyzeGameData([
      game('a', 'Alpha', { published_rule_count: 1 }),
      game('b', 'Beta', { published_rule_count: 5 }),
      game('c', 'Gamma', { bgg_id: 7 }),
      game('d', 'Delta', { visibility: 'hidden' }),
      game('e', 'Epsilon', { entity_kind: 'expansion' }),
      game('f', 'Zeta', { merged_into_game_id: 'a' }),
    ], []);
    expect(report.missingBggIds.map((row) => row.id)).toEqual(['b', 'a']);
    expect(hasInvariantFailures(report)).toBe(false);
  });

  test('finds duplicate names across display, English and alias text, ignoring merged rows', () => {
    const report = analyzeGameData([
      game('kept', 'Mountain Goats: Legacy', { bgg_id: 460712 }),
      game('dup', '山羊傳承', { english_name: 'Mountain Goats Legacy' }),
      game('other', '天燈谷'),
      game('old', 'Mountain Goats Legacy', { merged_into_game_id: 'kept' }),
    ], [{ id: 'x', game_id: 'other', alias: 'Valley of Sky Lanterns', normalized_alias: 'valleyofskylanterns' }]);
    expect(report.duplicateNameCandidates).toHaveLength(1);
    expect(report.duplicateNameCandidates[0].key).toBe('mountaingoatslegacy');
    expect(report.duplicateNameCandidates[0].games.map((row) => [row.id, row.matches])).toEqual([
      ['kept', ['name:Mountain Goats: Legacy']],
      ['dup', ['english:Mountain Goats Legacy']],
    ]);
  });

  test('treats stale stored keys and shared BGG IDs as invariant failures', () => {
    const report = analyzeGameData([
      game('a', 'Alpha', { bgg_id: 1, normalized_name: 'alpha' }),
      game('b', 'Beta', { bgg_id: 1, normalized_name: 'stale' }),
    ], []);
    expect(report.duplicateBggIds).toEqual([{ bggId: 1, games: expect.arrayContaining([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })]) }]);
    expect(report.noncanonicalKeys).toEqual([{ table: 'games', id: 'b', name: 'Beta', key: 'beta' }]);
    expect(hasInvariantFailures(report)).toBe(true);
  });
});
