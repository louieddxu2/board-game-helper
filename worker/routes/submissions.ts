import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, RULE_CATEGORIES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, cleanEditionNotes, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';

const submissionsRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

const submissionSchema = z.object({
  gameId: z.string().min(1).max(100),
  playedOn: z.string().max(20).optional(),
  sourceLabel: z.string().trim().max(300).optional(),
  sourceUrl: z.url().max(2000).optional().or(z.literal('')),
  privateNote: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(120),
  rules: z.array(z.object({
    statement: z.string().trim().min(1).max(2000),
    commonMistake: z.string().trim().max(2000).optional(),
    details: z.string().trim().max(5000).optional(),
    flowStage: z.enum(FLOW_STAGES).optional(),
    categories: z.array(z.enum(RULE_CATEGORIES)).max(RULE_CATEGORIES.length).optional(),
    playerCounts: z.array(z.number().int().min(1).max(8)).max(8).optional(),
    editionNotes: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
    editionNote: z.string().trim().max(300).optional(),
    sourceLabel: z.string().trim().max(300).optional(),
    sourceUrl: z.url().max(2000).optional().or(z.literal('')),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    tagIds: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
    newTagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  }).refine((value) => (value.tagIds?.length ?? 0) + (value.newTagNames?.length ?? value.tagNames?.length ?? 0) <= 8, {
    message: '最多只能選擇 8 個標籤',
  })).min(1).max(20),
});

submissionsRoutes.post('/api/submissions', requireRole('editor'), async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 64 * 1024) return c.json({ error: 'request_too_large' }, 413);
  const parsed = submissionSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_submission', issues: parsed.error.issues }, 400);
  const user = c.get('user')!;
  const existing = await getDatabase(c).statement(`
    SELECT id FROM submissions WHERE author_id = ? AND idempotency_key = ?
  `).bind(user.id, parsed.data.idempotencyKey).first<{ id: string }>();
  if (existing) return c.json({ submissionId: existing.id, reused: true });
  const game = await getDatabase(c).statement('SELECT id FROM games WHERE id = ? AND merged_into_game_id IS NULL')
    .bind(parsed.data.gameId).first();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const submissionId = createId('sub');
  const timestamp = now();
  const ruleIds: string[] = [];
  const statements: DatabaseStatement[] = [getDatabase(c).statement(`
    INSERT INTO submissions (
      id, game_id, author_id, idempotency_key, played_on, source_label,
      source_url, private_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    submissionId, parsed.data.gameId, user.id, parsed.data.idempotencyKey,
    cleanOptional(parsed.data.playedOn, 20) ?? null,
    cleanOptional(parsed.data.sourceLabel, 300) ?? null,
    cleanOptional(parsed.data.sourceUrl, 2000) ?? null,
    cleanOptional(parsed.data.privateNote, 2000) ?? null,
    timestamp,
  )];
  if (parsed.data.sourceUrl) {
    statements.push(getDatabase(c).statement(`
      INSERT INTO submission_sources (id, submission_id, label, url, position, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).bind(createId('source'), submissionId, cleanOptional(parsed.data.sourceLabel, 300) ?? null, parsed.data.sourceUrl, timestamp));
  }
  for (const input of parsed.data.rules) {
    const ruleId = createId('rule');
    const editionNotes = cleanEditionNotes(input.editionNotes ?? (input.editionNote ? [input.editionNote] : []));
    ruleIds.push(ruleId);
    statements.push(getDatabase(c).statement(`
      INSERT INTO rules (
        id, submission_id, game_id, statement, common_mistake, details,
        flow_stage, categories_json, player_counts_json, edition_notes_json, edition_note, source_label, source_url,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `).bind(
      ruleId, submissionId, parsed.data.gameId, input.statement,
      cleanOptional(input.commonMistake, 2000) ?? null,
      cleanOptional(input.details, 5000) ?? null,
      input.flowStage ?? 'uncategorized',
      JSON.stringify(Array.from(new Set(input.categories ?? []))),
      JSON.stringify(Array.from(new Set(input.playerCounts ?? [])).sort((a, b) => a - b)),
      JSON.stringify(editionNotes), editionNotes[0] ?? null,
      cleanOptional(input.sourceLabel ?? parsed.data.sourceLabel, 300) ?? null,
      cleanOptional(input.sourceUrl ?? parsed.data.sourceUrl, 2000) ?? null,
      user.id, timestamp, timestamp,
    ));
    statements.push(...await tagWriteStatements(
      c, ruleId, input.newTagNames ?? input.tagNames ?? [], user.id, timestamp, false, input.tagIds ?? [],
    ));
  }
  statements.push(getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, parsed.data.gameId));
  await getDatabase(c).batch(statements);
  return c.json({ submissionId, ruleIds, reused: false }, 201);
});


export { submissionsRoutes };
