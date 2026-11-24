import { Hono } from 'hono';
import { z } from 'zod';
import { RULE_CATEGORIES, type RuleCategory, type UncertainRule } from '../../src/shared/types';
import { requireRole, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { findOrCreateGameByName } from '../data/uncertainRuleGame';
import { createId, now } from '../utils';
import { setNoCache } from './shared';

// 不確定的桌遊規則 is the site owner's private question list for now, so every route is admin-only.
const uncertainRulesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

interface UncertainRuleRow {
  id: string;
  game_id: string;
  question: string;
  table_ruling: string | null;
  details: string | null;
  categories_json: string | null;
  player_counts_json: string | null;
  edition_notes_json: string | null;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
}

const parseList = <T>(json: string | null): T[] => {
  try { const value = json ? JSON.parse(json) : []; return Array.isArray(value) ? value : []; } catch { return []; }
};
const listJson = (values: unknown[] | undefined) => values?.length ? JSON.stringify(values) : null;

const toUncertainRule = (row: UncertainRuleRow): UncertainRule => {
  const categories = parseList<RuleCategory>(row.categories_json);
  const playerCounts = parseList<number>(row.player_counts_json);
  const editionNotes = parseList<string>(row.edition_notes_json);
  return {
    id: row.id,
    gameId: row.game_id,
    question: row.question,
    ...(row.table_ruling ? { tableRuling: row.table_ruling } : {}),
    ...(row.details ? { details: row.details } : {}),
    ...(categories.length ? { categories } : {}),
    ...(playerCounts.length ? { playerCounts } : {}),
    ...(editionNotes.length ? { editionNotes } : {}),
    checkedAt: row.checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

// The optional settings mirror a recorded rule's (docs/rule-list-import.md).
const fields = {
  question: z.string().trim().min(1).max(2000),
  tableRuling: z.string().trim().max(2000),
  details: z.string().trim().max(5000),
  categories: z.array(z.enum(RULE_CATEGORIES)).max(RULE_CATEGORIES.length),
  playerCounts: z.array(z.number().int().min(1).max(8)).max(8),
  editionNotes: z.array(z.string().trim().min(1).max(300)).max(20),
  checked: z.boolean(),
};
const createSchema = z.object({
  gameId: z.string().min(1).optional(),
  newGame: z.object({ displayName: z.string().trim().min(1).max(120), englishName: z.string().trim().max(120).optional() }).optional(),
  question: fields.question,
  tableRuling: fields.tableRuling.optional(),
  details: fields.details.optional(),
  categories: fields.categories.optional(),
  playerCounts: fields.playerCounts.optional(),
  editionNotes: fields.editionNotes.optional(),
  checked: fields.checked.optional(),
}).refine((value) => Boolean(value.gameId) !== Boolean(value.newGame), 'game_or_new_game');
// `checked: true` records a fresh lookup (today's date) even when one was already recorded.
const updateSchema = z.object({
  question: fields.question.optional(),
  tableRuling: fields.tableRuling.optional(),
  details: fields.details.optional(),
  categories: fields.categories.optional(),
  playerCounts: fields.playerCounts.optional(),
  editionNotes: fields.editionNotes.optional(),
  checked: fields.checked.optional(),
}).refine((value) => Object.keys(value).length > 0, 'empty_update');

const COLUMNS = 'id, game_id, question, table_ruling, details, categories_json, player_counts_json, edition_notes_json, checked_at, created_at, updated_at';
const SELECT = `SELECT ${COLUMNS} FROM uncertain_rules`;
const uniqueSorted = (values: number[] | undefined) => values && Array.from(new Set(values)).sort((a, b) => a - b);

uncertainRulesRoutes.get('/api/games/:id/uncertain-rules', requireRole('admin'), async (c) => {
  setNoCache(c);
  const game = await getDatabase(c).statement('SELECT id FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(c.req.param('id')).first<{ id: string }>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const { results } = await getDatabase(c).statement(`${SELECT} INDEXED BY idx_uncertain_rules_game WHERE game_id = ? ORDER BY created_at, id`)
    .bind(game.id).all<UncertainRuleRow>();
  return c.json({ uncertainRules: (results ?? []).map(toUncertainRule) });
});

uncertainRulesRoutes.post('/api/uncertain-rules', requireRole('admin'), async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_uncertain_rule' }, 400);
  const db = getDatabase(c);
  const input = parsed.data;
  const user = c.get('user')!;
  const timestamp = now();
  const target = input.gameId
    ? await db.statement('SELECT id, slug FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(input.gameId).first<{ id: string; slug: string }>()
    : null;
  if (input.gameId && !target) return c.json({ error: 'game_not_found' }, 404);
  const resolved = target ? { game: target, statements: [], created: false } : await findOrCreateGameByName(db, input.newGame!, user, timestamp);
  const row: UncertainRuleRow = {
    id: createId('uncertain'),
    game_id: resolved.game.id,
    question: input.question,
    table_ruling: input.tableRuling || null,
    details: input.details || null,
    categories_json: listJson(input.categories && Array.from(new Set(input.categories))),
    player_counts_json: listJson(uniqueSorted(input.playerCounts)),
    edition_notes_json: listJson(input.editionNotes && Array.from(new Set(input.editionNotes))),
    checked_at: input.checked ? timestamp : null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await getDatabase(c).batch([
    ...resolved.statements,
    db.statement(`INSERT INTO uncertain_rules (${COLUMNS}, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.id, row.game_id, row.question, row.table_ruling, row.details, row.categories_json, row.player_counts_json, row.edition_notes_json, row.checked_at, row.created_at, row.updated_at, user.id),
  ]);
  return c.json({ uncertainRule: toUncertainRule(row), gameSlug: resolved.game.slug, gameCreated: resolved.created }, 201);
});

uncertainRulesRoutes.patch('/api/games/:id/uncertain-rules/:ruleId', requireRole('admin'), async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_uncertain_rule' }, 400);
  const db = getDatabase(c);
  const current = await db.statement(`${SELECT} WHERE id = ? AND game_id = ?`).bind(c.req.param('ruleId'), c.req.param('id')).first<UncertainRuleRow>();
  if (!current) return c.json({ error: 'uncertain_rule_not_found' }, 404);
  const input = parsed.data;
  const timestamp = now();
  const keep = <T>(value: T | undefined, next: (value: T) => string | null, fallback: string | null) => value === undefined ? fallback : next(value);
  const updated: UncertainRuleRow = {
    ...current,
    question: input.question ?? current.question,
    table_ruling: keep(input.tableRuling, (value) => value || null, current.table_ruling),
    details: keep(input.details, (value) => value || null, current.details),
    categories_json: keep(input.categories, (value) => listJson(Array.from(new Set(value))), current.categories_json),
    player_counts_json: keep(input.playerCounts, (value) => listJson(uniqueSorted(value)), current.player_counts_json),
    edition_notes_json: keep(input.editionNotes, (value) => listJson(Array.from(new Set(value))), current.edition_notes_json),
    checked_at: input.checked === undefined ? current.checked_at : input.checked ? timestamp : null,
    updated_at: timestamp,
  };
  await db.statement(`UPDATE uncertain_rules SET question = ?, table_ruling = ?, details = ?, categories_json = ?, player_counts_json = ?,
      edition_notes_json = ?, checked_at = ?, updated_at = ? WHERE id = ?`)
    .bind(updated.question, updated.table_ruling, updated.details, updated.categories_json, updated.player_counts_json,
      updated.edition_notes_json, updated.checked_at, updated.updated_at, updated.id).run();
  return c.json({ uncertainRule: toUncertainRule(updated) });
});

uncertainRulesRoutes.delete('/api/games/:id/uncertain-rules/:ruleId', requireRole('admin'), async (c) => {
  const deleted = await getDatabase(c).statement('DELETE FROM uncertain_rules WHERE id = ? AND game_id = ?')
    .bind(c.req.param('ruleId'), c.req.param('id')).run();
  if (!deleted.meta?.changes) return c.json({ error: 'uncertain_rule_not_found' }, 404);
  return c.json({ ok: true });
});

export { uncertainRulesRoutes };
