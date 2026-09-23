// @vitest-environment node
import { expect, test } from 'vitest';
import {
  auditPendingMigrationDeletes,
  auditTriggerFanout,
  buildMigratedSchema,
} from './check-d1-trigger-fanout.mjs';
import { parsePendingMigrations } from './d1-migration-list.mjs';

test('the old declassification trigger and migration are rejected; the current schema is safe', () => {
  const old = buildMigratedSchema('0109_canonicalize_expansion_attribute_configurations.sql');
  try {
    expect(auditTriggerFanout(old).some((issue) =>
      issue.includes('attribute_subject_games_after_declassification')
      && issue.includes('unindexed foreign keys'))).toBe(true);
  } finally { old.close(); }

  const current = buildMigratedSchema();
  try {
    expect(auditTriggerFanout(current)).toEqual([]);
    expect(auditPendingMigrationDeletes(current, [
      '0109_canonicalize_expansion_attribute_configurations.sql',
    ]).some((issue) => issue.includes('attribute_vote_responses(subject_a_id)'))).toBe(true);
    expect(auditPendingMigrationDeletes(current, [
      '0110_preserve_declassified_attribute_subjects.sql',
      '0111_remove_unbounded_attribute_triggers.sql',
    ])).toEqual([]);
    const triggerNames = current.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()
      .map((row) => row.name);
    expect(triggerNames).not.toContain('attributes_score_states_after_insert');
    expect(triggerNames).not.toContain('attributes_score_states_after_activate');

    const plan = current.prepare(`EXPLAIN QUERY PLAN
      SELECT expansion_component.subject_id
      FROM attribute_subject_components expansion_component
      JOIN attribute_subject_components base_component
        ON base_component.subject_id = expansion_component.subject_id
       AND base_component.game_id = ?
       AND base_component.component_type = 'base'
      JOIN attribute_subjects subject
        ON subject.id = expansion_component.subject_id
       AND subject.kind = 'configuration'
      WHERE expansion_component.game_id = ?
        AND expansion_component.component_type = 'expansion'
      LIMIT 1
    `).all().map((row) => row.detail);
    expect(plan.some((detail) =>
      detail.includes('SEARCH expansion_component USING INDEX idx_attribute_subject_components_game'))).toBe(true);

    current.exec(`CREATE TRIGGER unsafe_history_read AFTER UPDATE ON games
      BEGIN SELECT COUNT(*) FROM attribute_vote_responses; END`);
    expect(auditTriggerFanout(current)).toContain('unsafe_history_read: trigger reads a growing history table');
  } finally { current.close(); }
});

test('remote migration listing must be complete before applying anything', () => {
  const listing = `Migrations to be applied:
┌───────────────────────────────────────────────────────────────┐
│ Name                                                          │
├───────────────────────────────────────────────────────────────┤
│ 0110_preserve_declassified_attribute_subjects.sql             │
└───────────────────────────────────────────────────────────────┘`;
  expect(parsePendingMigrations(listing)).toEqual(['0110_preserve_declassified_attribute_subjects.sql']);
  expect(parsePendingMigrations('No migrations to be applied!')).toEqual([]);
  expect(() => parsePendingMigrations('Cloudflare request failed')).toThrow(/Cannot identify/);
});
