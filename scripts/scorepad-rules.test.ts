// @vitest-environment node
import { expect, test } from 'vitest';
import { ScorepadApi } from '../worker';
import { createHarness } from './attributeReplayTestHarness';

const setup = () => {
  const h = createHarness();
  h.sqlite.exec('PRAGMA foreign_keys = OFF');
  // Only an editor's rules may skip review; the pending rule below stays pending.
  h.sqlite.exec(`INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at)
      VALUES('sp-author', 'sub-sp-author', 'sp-author@example.invalid', 'sp-author@example.invalid', 1, 1);
    INSERT INTO user_roles(user_id, role, granted_by, granted_at) VALUES('sp-author', 'editor', 'sp-author', 1);`);
  h.sqlite.exec(`
    INSERT INTO games(id, slug, display_name, english_name, normalized_name, created_at, updated_at, visibility, review_status, entity_kind, bgg_id)
      VALUES('sp-base', 'sp-base', '計分本體', 'Scorepad Base', '計分本體', 1, 1, 'public', 'pending', 'base', 980001),
        ('sp-expansion', 'sp-expansion', '計分擴充', NULL, '計分擴充', 1, 1, 'public', 'pending', 'expansion', 980002),
        ('sp-hidden', 'sp-hidden', '隱藏遊戲', NULL, '隱藏遊戲', 1, 1, 'hidden', 'pending', 'base', 980003);
    INSERT INTO game_entity_relations(id, source_game_id, target_game_id, relation_type, created_at)
      VALUES('sp-relation', 'sp-expansion', 'sp-base', 'expansion_of', 1);
    INSERT INTO rules(id, submission_id, game_id, statement, common_mistake, flow_stage, player_counts_json, tag_ids_json,
        importance_count, created_at, updated_at, created_by, status, review_status, source_label, source_url)
      VALUES('sp-setup', 'sp-sub-1', 'sp-base', '設置規則', '玩錯方式', 'setup', '[2,3]', '["tag-a"]', 4, 10, 10, 'sp-author', 'published', 'reviewed', '說明書', 'https://example.test/rules'),
        ('sp-pending', 'sp-sub-2', 'sp-base', '待審規則', NULL, 'round', '[]', '[]', 0, 20, 20, 'sp-author', 'published', 'pending', NULL, NULL),
        ('sp-hidden-rule', 'sp-sub-3', 'sp-base', '隱藏規則', NULL, 'setup', '[]', '[]', 0, 30, 30, 'sp-author', 'hidden', 'not_required', NULL, NULL),
        ('sp-other-rule', 'sp-sub-4', 'sp-hidden', '隱藏遊戲的規則', NULL, 'setup', '[]', '[]', 0, 40, 40, 'sp-author', 'published', 'not_required', NULL, NULL);
    INSERT INTO tags(id, slug, name, normalized_name, is_public, category_hints_json, detection_keywords_json, created_at, updated_at)
      VALUES('tag-a', 'tag-a', '計分板設置', '計分板設置', 1, '["teaching_setup_opening"]', '["擺放"]', 1, 1);
    INSERT INTO game_external_resources(id, game_id, name, category, url, created_by, created_at, updated_at)
      VALUES('sp-resource', 'sp-base', '教學影片', 'teaching', 'https://example.test/video', 'sp-author', 1, 1);`);
  h.sqlite.exec('PRAGMA foreign_keys = ON');
  const api = new ScorepadApi({}, h.env as never);
  const plan = (sql: string): string[] => h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all()
    .map((row: { detail: unknown }) => String(row.detail));
  // Every table is reached through an index; temp b-trees only order one game's rows.
  const scans = (sql: string) => plan(sql).filter((detail) => /^SCAN /.test(detail) && !/^SCAN (page|r|resource|matched|tag VIRTUAL TABLE|CONSTANT ROW|\(subquery)/.test(detail));
  return { ...h, api, scans };
};

test('getGameRules returns a base game\'s published rules, reviewed or not, without contributors, in one indexed query', async () => {
  const h = setup();
  h.executedSql.length = 0;
  const result = await h.api.getGameRules('sp-base');
  expect(h.executedSql).toHaveLength(1);
  expect(h.scans(h.executedSql[0])).toEqual([]);
  expect(result).toMatchObject({ gameId: 'sp-base', slug: 'sp-base', displayName: '計分本體', englishName: 'Scorepad Base' });
  expect(result!.rules.map((rule) => [rule.id, rule.reviewStatus])).toEqual([['sp-setup', 'reviewed'], ['sp-pending', 'pending']]);
  expect(result!.rules[0]).toEqual({
    id: 'sp-setup', statement: '設置規則', commonMistake: '玩錯方式', details: undefined, flowStage: 'setup',
    categories: [], playerCounts: [2, 3], editionNotes: [], reviewStatus: 'reviewed', importanceCount: 4, tagIds: ['tag-a'],
    sourceLinks: [{ label: '說明書', url: 'https://example.test/rules' }], createdAt: 10, updatedAt: 10,
  });
  expect(JSON.stringify(result)).not.toContain('sp-author');
  // The game page classifies rules through their tags' hints, so the tags come with the rules.
  expect(result!.tags).toEqual([{ id: 'tag-a', name: '計分板設置', categoryHints: ['teaching_setup_opening'], detectionKeywords: ['擺放'] }]);
  expect(result!.externalResources).toEqual([{ id: 'sp-resource', name: '教學影片', category: 'teaching', url: 'https://example.test/video' }]);
});

test('getGameRules answers null for games without rules of their own and rejects malformed ids before D1', async () => {
  const h = setup();
  h.executedSql.length = 0;
  await expect(h.api.getGameRules('sp-expansion')).resolves.toBeNull();
  await expect(h.api.getGameRules('sp-hidden')).resolves.toBeNull();
  await expect(h.api.getGameRules('missing-game')).resolves.toBeNull();
  expect(h.executedSql).toHaveLength(3);
  await expect(h.api.getGameRules("x' OR 1=1 --")).rejects.toThrow('game_id');
  await expect(h.api.getGameRules(42 as never)).rejects.toThrow('game_id');
  expect(h.executedSql).toHaveLength(3);
});

test('getRuleSummaryByBgg leads every BGG id of a game to the count and version of its base game in one indexed query', async () => {
  const h = setup();
  h.sqlite.exec(`INSERT INTO game_external_ids(id, game_id, source, external_id, relation, created_at)
    VALUES('sp-edition', 'sp-base', 'bgg', '980009', 'edition', 1);`);
  const rules = await h.api.getGameRules('sp-base');
  const expected = { ruleGameId: 'sp-base', publishedRuleCount: 2, ruleVersion: rules!.ruleVersion };
  for (const bggId of ['980001', '980009', '980002']) {
    h.executedSql.length = 0;
    expect(await h.api.getRuleSummaryByBgg(bggId)).toEqual(expected);
    expect(h.executedSql).toHaveLength(1);
    expect(h.scans(h.executedSql[0])).toEqual([]);
  }
  await expect(h.api.getRuleSummaryByBgg('980003')).resolves.toBeNull();
  await expect(h.api.getRuleSummaryByBgg('999999999')).resolves.toBeNull();

  // The version moves when a published rule is edited or hidden, and getGameRules reports the same one.
  h.sqlite.exec(`UPDATE rules SET statement = '設置規則（修訂）', updated_at = 50 WHERE id = 'sp-setup'`);
  const edited = await h.api.getRuleSummaryByBgg('980002');
  expect(edited!.ruleVersion).not.toBe(expected.ruleVersion);
  h.sqlite.exec(`UPDATE rules SET status = 'hidden', updated_at = 60 WHERE id = 'sp-pending'`);
  const hidden = await h.api.getRuleSummaryByBgg('980001');
  expect(hidden).toMatchObject({ publishedRuleCount: 1 });
  expect(hidden!.ruleVersion).toBe((await h.api.getGameRules('sp-base'))!.ruleVersion);
});

test('getRuleSummaryByBgg rejects anything but a positive integer string before D1', async () => {
  const h = setup();
  h.executedSql.length = 0;
  for (const bad of ['0', '12a', "1' OR 1=1", '', 980001 as never]) {
    await expect(h.api.getRuleSummaryByBgg(bad)).rejects.toThrow('positive_integer');
  }
  expect(h.executedSql).toHaveLength(0);
});
