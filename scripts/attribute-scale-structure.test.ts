// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { attributeCatalogChangesPayload, attributeCatalogPayload } from '../worker/data/attributeCatalog';
import { applyAttributeCatalogChanges } from '../src/lib/attributeCatalog';
import { parseAttributeScale } from '../src/shared/attributeScale';

describe('bipolar attribute storage compatibility', () => {
  test('response direction migration preserves old answers and permits reconstructing reversed answers', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("CREATE TABLE attribute_vote_responses(response_id TEXT PRIMARY KEY, rating_a REAL); INSERT INTO attribute_vote_responses VALUES('old', 8);");
      db.exec(readFileSync('migrations/0084_attribute_response_direction.sql', 'utf8'));
      expect(db.prepare('SELECT * FROM attribute_vote_responses').get()).toMatchObject({ rating_a: 8, question_high_pole: 'high' });
      db.exec("INSERT INTO attribute_vote_responses VALUES('new', 8, 'low')");
      expect(db.prepare("SELECT rating_a, question_high_pole FROM attribute_vote_responses WHERE response_id = 'new'").get()).toMatchObject({ rating_a: 8, question_high_pole: 'low' });
      expect(() => db.exec("INSERT INTO attribute_vote_responses VALUES('invalid', 8, 'other')")).toThrow();
    } finally { db.close(); }
  });
  test('keeps legacy definitions valid and rejects incomplete bipolar metadata', () => {
    expect(parseAttributeScale(undefined, undefined)).toEqual({});
    expect(parseAttributeScale('unipolar', null)).toEqual({});
    expect(() => parseAttributeScale('bipolar', { low: { label: '得分' } })).toThrow();
  });

  test('migrates existing definitions and carries endpoint edits through deltas and client cache', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE attributes(id TEXT PRIMARY KEY, key TEXT, is_active INTEGER, min_value REAL, max_value REAL, sort_order INTEGER);
        CREATE TABLE attribute_translations(attribute_id TEXT, locale TEXT, name TEXT, short_description TEXT, full_description TEXT, min_example TEXT, max_example TEXT);
        CREATE TABLE attribute_catalog_clock(id INTEGER PRIMARY KEY, current_version INTEGER);
        CREATE TABLE attribute_catalog_entries(entry_key TEXT PRIMARY KEY, catalog_version INTEGER, entry_json TEXT, deleted INTEGER, updated_at INTEGER);
        CREATE TABLE attribute_catalog_snapshot_state(id INTEGER PRIMARY KEY, attributes_json TEXT);
        INSERT INTO attribute_catalog_clock VALUES(1, 0);
        INSERT INTO attribute_catalog_snapshot_state VALUES(1, '[]');
        INSERT INTO attributes VALUES('victory', 'victory', 1, 0, 10, 0);
        INSERT INTO attribute_translations VALUES('victory', 'zh-TW', '原名稱', NULL, '原說明不變。', NULL, NULL);
      `);
      db.exec(readFileSync('migrations/0083_attribute_bipolar_structure.sql', 'utf8'));
      expect(db.prepare('SELECT scale_type FROM attributes').get()).toMatchObject({ scale_type: 'unipolar' });
      const snapshot = db.prepare('SELECT attributes_json FROM attribute_catalog_snapshot_state').get()!;
      const cached = attributeCatalogPayload({
        state: { results: [{ active_generation: 1, through_version: 0, chunk_count: 0, attributes_json: String(snapshot.attributes_json), score_model_version: 'test', generated_at: 1 }] },
        chunks: { results: [] },
      });
      expect(cached.attributes[0].fullDescription).toBe('原說明不變。');
      const endpoints = {
        low: { label: '得分取勝', question: '哪款得分取勝比重較高？', fullDescription: '保留得分原文。' },
        high: { label: '條件取勝', question: '哪款條件取勝比重較高？', fullDescription: '保留條件原文。' },
      };
      db.prepare('UPDATE attribute_translations SET endpoints_json = ?').run(JSON.stringify(endpoints));
      db.exec("UPDATE attributes SET scale_type = 'bipolar'");
      const delta = () => attributeCatalogChangesPayload({ results: db.prepare('SELECT * FROM attribute_catalog_entries').all() as never }, 0, { generation: 1, generatedAt: 1 });
      const changed = delta();
      expect(changed.changes[0].attribute).toMatchObject({ scaleType: 'bipolar', endpoints });
      expect(applyAttributeCatalogChanges(cached, changed.changes).attributes[0]).toMatchObject({ endpoints });
      endpoints.high.fullDescription = '之後修訂的說明。';
      db.prepare('UPDATE attribute_translations SET endpoints_json = ?').run(JSON.stringify(endpoints));
      expect(delta().changes[0].attribute?.endpoints?.high.fullDescription).toBe('之後修訂的說明。');
      db.exec("UPDATE attributes SET is_active = 0");
      expect(delta().changes[0].deleted).toBe(true);
    } finally { db.close(); }
  });
});
