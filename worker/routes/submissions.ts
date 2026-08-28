import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, RULE_CATEGORIES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireUser, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanAliases, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, cleanEditionNotes, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';
import { contributionErrorCode, initialReviewStatus, isTrustedEditor, queryContributionQuota } from '../contributions';
import { isSafeExternalUrl } from '../../src/shared/externalUrl';
import { ensureRuleGameVariantStatements } from '../data/gameEntities';

const submissionsRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

export const submissionSchema = z.object({
  gameId: z.string().min(1).max(100).optional(),
  newGame: z.object({
    displayName: z.string().trim().min(1).max(120),
    englishName: z.string().trim().max(120).optional(),
  }).optional(),
  sourceLabel: z.string().trim().max(300).optional(),
  sourceUrl: z.url().max(2000).refine(isSafeExternalUrl, 'source_url_must_be_https').optional().or(z.literal('')),
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
    sourceUrl: z.url().max(2000).refine(isSafeExternalUrl, 'source_url_must_be_https').optional().or(z.literal('')),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
    tagIds: z.array(z.string().trim().min(1).max(100)).max(6).optional(),
    newTagNames: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  }).refine((value) => (value.tagIds?.length ?? 0) + (value.newTagNames?.length ?? value.tagNames?.length ?? 0) <= 6, {
    message: '最多只能選擇 6 個標籤',
  })).min(1).max(20),
}).refine((value) => Boolean(value.gameId) !== Boolean(value.newGame), {
  message: 'exactly_one_game_target_required',
});

submissionsRoutes.post('/api/submissions', requireUser, async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 64 * 1024) return c.json({ error: 'request_too_large' }, 413);
  const parsed = submissionSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_submission', issues: parsed.error.issues }, 400);
  const user = c.get('user')!;
  const findExisting = () => getDatabase(c).statement(`
    SELECT s.id, s.game_id, g.slug game_slug
    FROM submissions s JOIN games g ON g.id = s.game_id
    WHERE s.author_id = ? AND s.idempotency_key = ?
  `).bind(user.id, parsed.data.idempotencyKey).first<{ id: string; game_id: string; game_slug: string }>();
  const existing = await findExisting();
  if (existing) return c.json({
    submissionId: existing.id, gameId: existing.game_id, gameSlug: existing.game_slug,
    gameCreated: false, reused: true,
  });
  const accountLimit = await c.env.WRITE_RATE_LIMITER.limit({ key: `contribution:${user.id}` });
  if (!accountLimit.success) {
    c.header('Retry-After', '60');
    return c.json({ error: 'rate_limited' }, 429);
  }
  const trusted = isTrustedEditor(user);
  const quota = trusted ? undefined : await queryContributionQuota(getDatabase(c), user.id);
  if (quota && parsed.data.rules.length > quota.remainingRules) {
    return c.json({ error: 'PENDING_RULE_LIMIT_REACHED', quota }, 409);
  }

  let gameId = parsed.data.gameId;
  let gameSlug: string | undefined;
  let gameCreated = false;
  const timestamp = now();
  const statements: DatabaseStatement[] = [];
  if (gameId) {
    const game = await getDatabase(c).statement(`
      SELECT id, slug FROM games
      WHERE id = ? AND merged_into_game_id IS NULL AND visibility = 'public'
    `).bind(gameId).first<{ id: string; slug: string }>();
    if (!game) return c.json({ error: 'game_not_found' }, 404);
    gameSlug = game.slug;
  } else {
    const requested = parsed.data.newGame!;
    const normalizedName = normalizeText(requested.displayName);
    const existingGame = await getDatabase(c).statement(`
      SELECT g.id, g.slug FROM games g
      LEFT JOIN game_aliases a ON a.game_id = g.id
      WHERE g.merged_into_game_id IS NULL AND g.visibility = 'public'
        AND (g.normalized_name = ? OR a.normalized_alias = ?)
      LIMIT 1
    `).bind(normalizedName, normalizedName).first<{ id: string; slug: string }>();
    if (existingGame) {
      gameId = existingGame.id;
      gameSlug = existingGame.slug;
    } else {
      if (quota && quota.remainingGames < 1) {
        return c.json({ error: 'PENDING_GAME_LIMIT_REACHED', quota }, 409);
      }
      gameId = createId('game');
      const baseSlug = slugify(requested.englishName || requested.displayName);
      const slugExists = await getDatabase(c).statement('SELECT 1 found FROM games WHERE slug = ?').bind(baseSlug).first();
      gameSlug = slugExists ? `${baseSlug}-${gameId.slice(-6)}` : baseSlug;
      const gameReviewStatus = initialReviewStatus(user);
      statements.push(getDatabase(c).statement(`
        INSERT INTO games (
          id, slug, display_name, english_name, normalized_name, created_by, rename_owner_id,
          created_at, updated_at, visibility, review_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?)
      `).bind(
        gameId, gameSlug, requested.displayName, cleanOptional(requested.englishName, 120) ?? null,
        normalizedName, user.id, user.id, timestamp, timestamp, gameReviewStatus,
      ));
      for (const alias of cleanAliases([], requested.displayName, requested.englishName)) {
        statements.push(getDatabase(c).statement(`
          INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(createId('alias'), gameId, alias, normalizeText(alias), alias === requested.displayName ? 'official' : 'alias', timestamp));
      }
      gameCreated = true;
    }
  }
  if (!gameId) return c.json({ error: 'game_not_found' }, 404);
  const submissionId = createId('sub');
  const ruleIds: string[] = [];
  statements.push(getDatabase(c).statement(`
    INSERT INTO submissions (
      id, game_id, author_id, idempotency_key, source_label,
      source_url
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    submissionId, gameId, user.id, parsed.data.idempotencyKey,
    cleanOptional(parsed.data.sourceLabel, 300) ?? null,
    cleanOptional(parsed.data.sourceUrl, 2000) ?? null,
  ));
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
        pending_review_by, status, created_by, created_at, updated_at, review_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)
    `).bind(
      ruleId, submissionId, gameId, input.statement,
      cleanOptional(input.commonMistake, 2000) ?? null,
      cleanOptional(input.details, 5000) ?? null,
      input.flowStage ?? 'uncategorized',
      JSON.stringify(Array.from(new Set(input.categories ?? []))),
      JSON.stringify(Array.from(new Set(input.playerCounts ?? [])).sort((a, b) => a - b)),
      JSON.stringify(editionNotes), editionNotes[0] ?? null,
      cleanOptional(input.sourceLabel ?? parsed.data.sourceLabel, 300) ?? null,
      cleanOptional(input.sourceUrl ?? parsed.data.sourceUrl, 2000) ?? null,
      initialReviewStatus(user) === 'pending' ? user.id : null,
      user.id, timestamp, timestamp, initialReviewStatus(user),
    ));
    statements.push(...await ensureRuleGameVariantStatements(
      getDatabase(c), gameId, ruleId, editionNotes, timestamp,
    ));
    statements.push(...await tagWriteStatements(
      c, ruleId, input.newTagNames ?? input.tagNames ?? [], user.id, timestamp, false, input.tagIds ?? [],
    ));
  }
  statements.push(getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, gameId));
  try {
    await getDatabase(c).batch(statements);
  } catch (error) {
    const code = contributionErrorCode(error);
    if (code) return c.json({ error: code }, 409);
    if (String(error).toLowerCase().includes('unique')) {
      const raced = await findExisting();
      if (raced) return c.json({
        submissionId: raced.id, gameId: raced.game_id, gameSlug: raced.game_slug,
        gameCreated: false, reused: true,
      });
    }
    throw error;
  }
  const updatedQuota = trusted ? undefined : await queryContributionQuota(getDatabase(c), user.id);
  return c.json({ submissionId, ruleIds, gameId, gameSlug, gameCreated, quota: updatedQuota, reused: false }, 201);
});


export { submissionsRoutes };
