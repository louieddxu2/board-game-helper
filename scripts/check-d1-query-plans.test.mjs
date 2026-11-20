// @vitest-environment node
import { expect, test } from 'vitest';
import { auditStatisticsScans, collectWorkerSql } from './check-d1-query-plans.mjs';

test('no worker query scans a table only because of stored statistics', () => {
  const statements = collectWorkerSql();
  const { issues, explained, total } = auditStatisticsScans(statements);
  expect(issues).toEqual([]);
  // Keep the audit meaningful: almost every statement must be reconstructable.
  expect(explained / total).toBeGreaterThan(0.9);
});

test('the audit rejects the historical login and contributor lookups', () => {
  const statements = [
    { file: 'worker/auth.ts', line: 1, texts: ['SELECT id, google_sub FROM users WHERE google_sub = ? OR email_hash IN (?, ?)'] },
    { file: 'worker/routes/shared.ts', line: 1, texts: ['SELECT id, nickname FROM users WHERE show_nickname = 1 AND id IN (?, ?)'] },
    { file: 'worker/routes/games.ts', line: 1, texts: ['SELECT g.id, reviewer.show_nickname FROM games g LEFT JOIN users reviewer ON reviewer.id = g.reviewed_by WHERE g.id = ?'] },
  ];
  expect(auditStatisticsScans(statements).issues).toEqual([
    'worker/auth.ts:1 scans users only under stored statistics',
    'worker/routes/shared.ts:1 scans users only under stored statistics',
    'worker/routes/games.ts:1 scans users only under stored statistics',
  ]);
});
