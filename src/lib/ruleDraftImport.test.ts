import { describe, expect, test } from 'vitest';
import { parseRuleDraftImport, RULE_DRAFT_IMPORT_FORMAT, RULE_DRAFT_IMPORT_SCHEMA_VERSION } from './ruleDraftImport';

describe('rule draft import', () => {
  test('validates and normalizes a Codex-generated rule list', () => {
    const parsed = parseRuleDraftImport(JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT,
      schemaVersion: RULE_DRAFT_IMPORT_SCHEMA_VERSION,
      game: { displayName: '  範例遊戲  ', englishName: ' Example ' },
      sourceLabel: '規則書',
      sourceUrl: 'https://example.com/rules',
      rules: [{
        statement: '  每回合抽一張牌。 ',
        categories: ['action_effect_detail', 'action_effect_detail'],
        playerCounts: [4, 2, 4],
        tagNames: ['手牌', '手牌'],
      }],
    }));

    expect(parsed.game).toEqual({ displayName: '範例遊戲', englishName: 'Example' });
    expect(parsed.rules[0]).toMatchObject({
      statement: '每回合抽一張牌。',
      categories: ['action_effect_detail'],
      playerCounts: [2, 4],
      tagNames: ['手牌'],
      sourceLabel: '規則書',
      sourceUrl: 'https://example.com/rules',
    });
  });

  test('preserves the canonical rule fields used by submissions', () => {
    const parsed = parseRuleDraftImport(JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT,
      schemaVersion: RULE_DRAFT_IMPORT_SCHEMA_VERSION,
      game: { displayName: '柏林咖啡館', englishName: 'Seize the Bean' },
      sourceUrl: '',
      rules: [{
        statement: '規則結論',
        commonMistake: '常見誤解',
        details: '補充說明',
        flowStage: 'action',
        categories: ['action_effect_detail'],
        sourceUrl: '',
        tagNames: ['急速運輸'],
      }],
    }));

    expect(parsed.schemaVersion).toBe(RULE_DRAFT_IMPORT_SCHEMA_VERSION);
    expect(parsed.sourceUrl).toBeUndefined();
    expect(parsed.rules[0]).toMatchObject({
      details: '補充說明', flowStage: 'action', categories: ['action_effect_detail'], tagNames: ['急速運輸'],
    });
    expect(parsed.rules[0].sourceUrl).toBeUndefined();
  });

  test.each([
    [{ format: 'other', schemaVersion: 1, game: { displayName: '遊戲' }, rules: [{ statement: '規則' }] }],
    [{ format: RULE_DRAFT_IMPORT_FORMAT, schemaVersion: 1, game: { id: 'g1', displayName: '遊戲' }, rules: [{ statement: '規則' }] }],
    [{ format: RULE_DRAFT_IMPORT_FORMAT, schemaVersion: 1, game: { displayName: '遊戲' }, rules: [{ statement: '規則', sourceUrl: 'not-a-url' }] }],
  ])('rejects an unsafe or incompatible file', (input) => {
    expect(() => parseRuleDraftImport(JSON.stringify(input))).toThrow('匯入格式錯誤');
  });

  test('rejects more rules than one submission can accept', () => {
    const rules = Array.from({ length: 21 }, (_, index) => ({ statement: `規則 ${index}` }));
    expect(() => parseRuleDraftImport(JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT, schemaVersion: 1, game: { displayName: '遊戲' }, rules,
    }))).toThrow('匯入格式錯誤');
  });

  test('accepts the exact 20-rule submission boundary', () => {
    const rules = Array.from({ length: 20 }, (_, index) => ({ statement: `規則 ${index}` }));
    expect(parseRuleDraftImport(JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT, schemaVersion: 1, game: { displayName: '遊戲' }, rules,
    })).rules).toHaveLength(20);
  });

  test('ignores legacy play-date and private-note fields', () => {
    const parsed = parseRuleDraftImport(JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT,
      schemaVersion: 1,
      game: { displayName: '遊戲' },
      playedOn: '2026-08-02',
      privateNote: '舊版私人備註',
      rules: [{ statement: '規則' }],
    }));
    expect(parsed).not.toHaveProperty('playedOn');
    expect(parsed).not.toHaveProperty('privateNote');
  });

  test('rejects malformed JSON and files larger than the server request limit', () => {
    expect(() => parseRuleDraftImport('{')).toThrow('檔案不是有效的 JSON');
    expect(() => parseRuleDraftImport('x'.repeat(64 * 1024 + 1))).toThrow('匯入檔不可超過 64 KB');
  });
});
