// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { applyAttributeCatalogChanges } from '../src/lib/attributeCatalog';
import { attributeCatalogChangesPayload } from '../worker/data/attributeCatalog';
import type { AttributeCatalogPayload } from '../src/shared/types';

test('setup description migration updates the catalog cache while preserving ratings', () => {
  const sqlite = new DatabaseSync(':memory:');
  const migration = '0125_clarify_setup_variability_description.sql';
  try {
    for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql') && file < migration).sort()) {
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
    }
    const attributeId = 'attribute_setup_variability';
    const before = sqlite.prepare('SELECT * FROM attribute_translations WHERE attribute_id = ? AND locale = ?')
      .get(attributeId, 'zh-TW');
    const responses = sqlite.prepare('SELECT * FROM attribute_vote_responses ORDER BY response_id').all();
    const scores = sqlite.prepare('SELECT * FROM attribute_score_states ORDER BY subject_id, attribute_id').all();
    const { current_version: version } = sqlite.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1')
      .get() as { current_version: number };
    const cached: AttributeCatalogPayload = {
      generation: 1, generatedAt: 1, throughVersion: version,
      attributes: [{ id: attributeId, key: 'setup_variability', name: '設置變化',
        fullDescription: String(before?.full_description), minValue: 0, maxValue: 10, sortOrder: 7 }],
      subjects: [], values: [], candidates: [], activities: [],
    };

    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));

    const description = '在遊戲第一輪開始前會影響整場遊戲的隨機設置的變化性';
    expect(sqlite.prepare('SELECT * FROM attribute_translations WHERE attribute_id = ? AND locale = ?')
      .get(attributeId, 'zh-TW')).toEqual({ ...before, full_description: description });
    const entries = sqlite.prepare('SELECT * FROM attribute_catalog_entries WHERE catalog_version > ? ORDER BY catalog_version')
      .all(version);
    const delta = attributeCatalogChangesPayload({ results: entries as never }, version, { generation: 1, generatedAt: 1 });
    expect(delta.changes).toHaveLength(1);
    expect(applyAttributeCatalogChanges(cached, delta.changes, delta.throughVersion).attributes[0])
      .toMatchObject({ id: attributeId, name: '設置變化', fullDescription: description });
    expect(sqlite.prepare('SELECT * FROM attribute_vote_responses ORDER BY response_id').all()).toEqual(responses);
    expect(sqlite.prepare('SELECT * FROM attribute_score_states ORDER BY subject_id, attribute_id').all()).toEqual(scores);
    expect(sqlite.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').get())
      .toEqual({ current_version: version + 1 });
  } finally {
    sqlite.close();
  }
});
