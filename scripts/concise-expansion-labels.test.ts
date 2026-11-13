// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, expect, test } from 'vitest';

const sqlite = new DatabaseSync(':memory:');
const configurationName = (expansionId: string) => (sqlite.prepare(`
  SELECT s.display_name AS name, c.label
  FROM attribute_subjects s
  JOIN attribute_subject_components c ON c.subject_id = s.id AND c.component_type = 'expansion'
  WHERE s.kind = 'configuration' AND c.game_id = ?
`).get(expansionId) as { name: string; label: string } | undefined);

beforeAll(() => {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  sqlite.exec('DELETE FROM catalog_change_outbox;');
});

test('existing BGG expansion configurations use a concise Chinese expansion label', () => {
  expect(configurationName('game_bgg_338013')).toEqual({ name: '馬拉開波＋起義擴', label: '起義擴' });
  expect(configurationName('game_bgg_226441')?.label).toBe('茶與貿易擴');
  expect(configurationName('game_bgg_286287')?.label).toBe('偉大發現擴');
  expect(configurationName('game_bgg_366469')?.label).toBe('尼羅河擴');
});

test('a newly related expansion drops the repeated base name and is published once', () => {
  sqlite.exec(`
    INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_at, updated_at, visibility, review_status, attribute_enabled, bgg_id, entity_kind)
    VALUES ('base-catan', 'catan', '卡坦島', 'Catan', '卡坦島', 1, 1, 'public', 'pending', 1, 13, 'base'),
      ('exp-seafarers', 'bgg-325', '卡坦島：航海家', 'Catan: Seafarers', '卡坦島航海家', 1, 1, 'public', 'pending', 1, 325, 'expansion'),
      ('exp-english', 'bgg-926', 'Catan: Cities & Knights', NULL, 'catancitiesknights', 1, 1, 'public', 'pending', 1, 926, 'expansion'),
      ('exp-plain', 'bgg-1', '海盜擴充', NULL, '海盜擴充', 1, 1, 'public', 'pending', 1, 1, 'expansion');
    INSERT INTO game_entity_relations (id, source_game_id, target_game_id, relation_type, created_at)
    VALUES ('r1', 'exp-seafarers', 'base-catan', 'expansion_of', 1),
      ('r2', 'exp-english', 'base-catan', 'expansion_of', 1),
      ('r3', 'exp-plain', 'base-catan', 'expansion_of', 1);
  `);
  expect(configurationName('exp-seafarers')).toEqual({ name: '卡坦島＋航海家擴', label: '航海家擴' });
  expect(configurationName('exp-english')).toEqual({ name: '卡坦島＋Cities & Knights', label: 'Cities & Knights' });
  expect(configurationName('exp-plain')).toEqual({ name: '卡坦島＋海盜擴充', label: '海盜擴充' });
  // The expansion game keeps its full title for the rules site.
  expect(sqlite.prepare("SELECT display_name FROM games WHERE id = 'exp-seafarers'").get()).toEqual({ display_name: '卡坦島：航海家' });
  const outbox = sqlite.prepare(`SELECT entity_key FROM catalog_change_outbox
    WHERE catalog = 'attribute-subject' AND entity_key LIKE 'attribute_config_expansion:%' ORDER BY entity_key`).all();
  expect(outbox).toHaveLength(3);
});
