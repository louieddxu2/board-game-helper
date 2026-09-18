// @vitest-environment node

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

test('outbox activation removes broad catalog writers but retains component-name maintenance', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const activationSql = read('scripts/catalog-outbox-activation.sql');
    expect(activationSql).not.toMatch(/^\s*BEGIN\s+IMMEDIATE;/m);
    expect(activationSql).not.toMatch(/^\s*COMMIT;/m);
    sqlite.exec(read('tests/fixtures/production-d1-schema.sql'));
    sqlite.exec(read('migrations/0105_catalog_outbox_foundation.sql'));
    sqlite.exec(activationSql);

    const triggers = sqlite.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'trigger'
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;
    const byName = new Map(triggers.map((trigger) => [trigger.name, trigger.sql]));

    for (const name of [
      'attribute_subject_components_catalog_after_insert',
      'attribute_subject_components_catalog_after_update',
      'attribute_subject_components_catalog_after_delete',
    ]) {
      expect(byName.get(name)).toContain('UPDATE attribute_subjects');
      expect(byName.get(name)).not.toContain('attribute_subject_display_names');
    }
    expect(byName.has('attribute_subjects_catalog_after_update')).toBe(false);
    expect(triggers.some((trigger) => /attribute_subject_catalog_source|attribute_catalog_entries\s*\(/i.test(trigger.sql))).toBe(false);
    expect(triggers.some((trigger) => /catalog_outbox_settings/i.test(trigger.sql))).toBe(false);

    const plan = (sql: string) => (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
      .map((row) => row.detail).join('\n');
    expect(plan("SELECT id FROM attribute_subjects WHERE game_id = 'game-a'"))
      .toMatch(/USING (?:COVERING )?INDEX idx_attribute_subjects_game/);
    expect(plan("SELECT subject_id FROM attribute_subject_components WHERE game_id = 'game-a'"))
      .toMatch(/USING (?:COVERING )?INDEX idx_attribute_subject_components_game/);
    expect(plan("SELECT source_game_id FROM game_entity_relations WHERE target_game_id = 'game-a'"))
      .toMatch(/USING (?:COVERING )?INDEX idx_game_entity_relations_target_type_source/);
    expect(plan("SELECT label FROM attribute_subject_components WHERE subject_id = 'subject-a' AND component_type = 'base' ORDER BY component_order LIMIT 1"))
      .toMatch(/USING INDEX idx_attribute_subject_components_subject_type_order/);

    sqlite.exec(`
      INSERT INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
      VALUES ('outbox-test-subject', 'outbox-test-subject', 'configuration', '舊名稱', NULL, 1, 1);
      INSERT INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
      VALUES ('outbox-test-subject', 0, NULL, 'base', '基礎遊戲');
      INSERT INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
      VALUES ('outbox-test-subject', 1, NULL, 'expansion', '擴充甲');
    `);
    expect(sqlite.prepare('SELECT display_name FROM attribute_subjects WHERE id = ?')
      .get('outbox-test-subject')).toEqual({ display_name: '基礎遊戲＋擴充甲' });
    sqlite.prepare(`
      UPDATE attribute_subject_components
      SET label = '擴充乙'
      WHERE subject_id = ? AND component_order = 1
    `).run('outbox-test-subject');
    expect(sqlite.prepare('SELECT display_name FROM attribute_subjects WHERE id = ?')
      .get('outbox-test-subject')).toEqual({ display_name: '基礎遊戲＋擴充乙' });
    expect(sqlite.prepare(`
      SELECT catalog, entity_key
      FROM catalog_change_outbox
      WHERE catalog = 'attribute-subject' AND entity_key = ?
    `).get('outbox-test-subject')).toEqual({ catalog: 'attribute-subject', entity_key: 'outbox-test-subject' });

    sqlite.exec(`
      INSERT INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
      VALUES ('outbox-test-target', 'outbox-test-target', 'configuration', '另一個舊名稱', NULL, 1, 1);
      INSERT INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
      VALUES ('outbox-test-target', 0, NULL, 'base', '第二個基礎遊戲');
      DELETE FROM catalog_change_outbox
      WHERE catalog = 'attribute-subject'
        AND entity_key IN ('outbox-test-subject', 'outbox-test-target');
    `);
    sqlite.prepare(`
      UPDATE attribute_subject_components
      SET subject_id = 'outbox-test-target'
      WHERE subject_id = 'outbox-test-subject' AND component_order = 1
    `).run();
    expect(sqlite.prepare('SELECT id, display_name FROM attribute_subjects WHERE id IN (?, ?) ORDER BY id')
      .all('outbox-test-subject', 'outbox-test-target')).toEqual([
      { id: 'outbox-test-subject', display_name: '基礎遊戲' },
      { id: 'outbox-test-target', display_name: '第二個基礎遊戲＋擴充乙' },
    ]);
    expect(sqlite.prepare(`
      SELECT entity_key
      FROM catalog_change_outbox
      WHERE catalog = 'attribute-subject'
        AND entity_key IN ('outbox-test-subject', 'outbox-test-target')
      ORDER BY entity_key
    `).all()).toEqual([
      { entity_key: 'outbox-test-subject' },
      { entity_key: 'outbox-test-target' },
    ]);
  } finally {
    sqlite.close();
  }
});
