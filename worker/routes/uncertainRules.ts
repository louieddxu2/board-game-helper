import { Hono } from 'hono';
import { z } from 'zod';
import type { UncertainRule } from '../../src/shared/types';
import { requireRole, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { createId, now } from '../utils';
import { setNoCache } from './shared';

// 不確定的桌遊規則 is the site owner's private question list for now, so every route is admin-only.
const uncertainRulesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

interface UncertainRuleRow {
  id: string;
  game_id: string;
  question: string;
  table_ruling: string | null;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
}

const toUncertainRule = (row: UncertainRuleRow): UncertainRule => ({
  id: row.id,
  gameId: row.game_id,
  question: row.question,
  ...(row.table_ruling ? { tableRuling: row.table_ruling } : {}),
  checkedAt: row.checked_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const questionField = z.string().trim().min(1).max(2000);
const rulingField = z.string().trim().max(2000);
const createSchema = z.object({ question: questionField, tableRuling: rulingField.optional(), checked: z.boolean().optional() });
// `checked: true` records a fresh lookup (today's date) even when one was already recorded.
const updateSchema = z.object({ question: questionField.optional(), tableRuling: rulingField.optional(), checked: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'empty_update');

const SELECT = 'SELECT id, game_id, question, table_ruling, checked_at, created_at, updated_at FROM uncertain_rules';

const findGame = (c: Parameters<typeof getDatabase>[0], id: string) => getDatabase(c)
  .statement('SELECT id FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(id).first<{ id: string }>();

uncertainRulesRoutes.get('/api/games/:id/uncertain-rules', requireRole('admin'), async (c) => {
  setNoCache(c);
  const game = await findGame(c, c.req.param('id'));
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const { results } = await getDatabase(c).statement(`${SELECT} INDEXED BY idx_uncertain_rules_game WHERE game_id = ? ORDER BY created_at, id`)
    .bind(game.id).all<UncertainRuleRow>();
  return c.json({ uncertainRules: (results ?? []).map(toUncertainRule) });
});

uncertainRulesRoutes.post('/api/games/:id/uncertain-rules', requireRole('admin'), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_uncertain_rule' }, 400);
  const game = await findGame(c, c.req.param('id'));
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const timestamp = now();
  const row: UncertainRuleRow = {
    id: createId('uncertain'),
    game_id: game.id,
    question: parsed.data.question,
    table_ruling: parsed.data.tableRuling || null,
    checked_at: parsed.data.checked ? timestamp : null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await getDatabase(c).statement(`
    INSERT INTO uncertain_rules (id, game_id, question, table_ruling, checked_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(row.id, row.game_id, row.question, row.table_ruling, row.checked_at, c.get('user')!.id, row.created_at, row.updated_at).run();
  return c.json({ uncertainRule: toUncertainRule(row) }, 201);
});

uncertainRulesRoutes.patch('/api/games/:id/uncertain-rules/:ruleId', requireRole('admin'), async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_uncertain_rule' }, 400);
  const db = getDatabase(c);
  const current = await db.statement(`${SELECT} WHERE id = ? AND game_id = ?`).bind(c.req.param('ruleId'), c.req.param('id')).first<UncertainRuleRow>();
  if (!current) return c.json({ error: 'uncertain_rule_not_found' }, 404);
  const timestamp = now();
  const next: UncertainRuleRow = {
    ...current,
    question: parsed.data.question ?? current.question,
    table_ruling: parsed.data.tableRuling === undefined ? current.table_ruling : parsed.data.tableRuling || null,
    checked_at: parsed.data.checked === undefined ? current.checked_at : parsed.data.checked ? timestamp : null,
    updated_at: timestamp,
  };
  await db.statement('UPDATE uncertain_rules SET question = ?, table_ruling = ?, checked_at = ?, updated_at = ? WHERE id = ?')
    .bind(next.question, next.table_ruling, next.checked_at, next.updated_at, next.id).run();
  return c.json({ uncertainRule: toUncertainRule(next) });
});

uncertainRulesRoutes.delete('/api/games/:id/uncertain-rules/:ruleId', requireRole('admin'), async (c) => {
  const deleted = await getDatabase(c).statement('DELETE FROM uncertain_rules WHERE id = ? AND game_id = ?')
    .bind(c.req.param('ruleId'), c.req.param('id')).run();
  if (!deleted.meta?.changes) return c.json({ error: 'uncertain_rule_not_found' }, 404);
  return c.json({ ok: true });
});

export { uncertainRulesRoutes };
