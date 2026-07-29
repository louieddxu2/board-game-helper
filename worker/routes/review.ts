import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type ReviewBatch, type ReviewProposal, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { normalizeText, now, sha256Hex, createId } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, cleanTagNames, tagWriteStatements, reviewContentFromRow, reviewRuleSelect, RuleRow, ReviewRuleRow } from './shared';

const reviewRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

reviewRoutes.get('/api/admin/review/export', requireRole('admin'), async (c) => {
  const gameIds = (c.req.query('gameIds') ?? c.req.query('gameId') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean).slice(0, 50);
  const flowStages = (c.req.query('flowStages') ?? c.req.query('flowStage') ?? '')
    .split(',').map((value) => value.trim()).filter((value): value is FlowStage => FLOW_STAGES.includes(value as FlowStage));
  const tag = (c.req.query('tag') ?? '').trim().slice(0, 40);
  const query = (c.req.query('q') ?? '').trim().slice(0, 120);
  const missingSource = c.req.query('missingSource') === '1';
  const updatedAfter = Math.max(0, Number(c.req.query('updatedAfter') ?? 0) || 0);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
  const conditions = [`r.status = 'published'`, 'g.merged_into_game_id IS NULL'];
  const bindings: unknown[] = [];
  if (gameIds.length) {
    conditions.push(`r.game_id IN (${gameIds.map(() => '?').join(',')})`);
    bindings.push(...gameIds);
  }
  if (flowStages.length) {
    conditions.push(`r.flow_stage IN (${flowStages.map(() => '?').join(',')})`);
    bindings.push(...flowStages);
  }
  if (tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM rule_tags filter_rt JOIN tags filter_t ON filter_t.id = filter_rt.tag_id
      WHERE filter_rt.rule_id = r.id AND (filter_t.slug = ? OR filter_t.normalized_name = ?)
    )`);
    bindings.push(tag, normalizeText(tag));
  }
  if (query) {
    conditions.push('(r.statement LIKE ? COLLATE NOCASE OR r.common_mistake LIKE ? COLLATE NOCASE OR r.details LIKE ? COLLATE NOCASE)');
    bindings.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (missingSource) conditions.push(`COALESCE(r.source_url, '') = '' AND COALESCE(r.source_label, '') = ''`);
  if (updatedAfter) {
    conditions.push('r.updated_at >= ?');
    bindings.push(updatedAfter);
  }
  const result = await getDatabase(c).statement(`${reviewRuleSelect}
    WHERE ${conditions.join(' AND ')}
    ORDER BY g.display_name, r.updated_at DESC, r.id
    LIMIT ?
  `).bind(...bindings, limit).all<ReviewRuleRow>();
  const rows = result.results ?? [];
  const items = await Promise.all(rows.map(async (row) => {
    const current = reviewContentFromRow(row);
    return {
      action: 'unchanged' as const,
      target: {
        type: 'rule' as const,
        id: row.id,
        gameId: row.game_id,
        gameName: row.game_name,
        gameSlug: row.game_slug,
      },
      base: { updatedAt: row.updated_at, contentHash: await reviewContentHash(current) },
      current,
      proposed: current,
      reason: '',
    };
  }));
  const scope = { gameIds, flowStages, tag: tag || undefined, query: query || undefined, missingSource, updatedAfter: updatedAfter || undefined, limit };
  const datasetVersion = await sha256Hex(JSON.stringify(items.map((item) => [item.target.id, item.base.updatedAt, item.base.contentHash])));
  const timestamp = now();
  const file: ReviewFile = {
    format: REVIEW_FORMAT,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    name: `校稿包 ${new Date(timestamp).toISOString().slice(0, 10)}`,
    exportedAt: timestamp,
    datasetVersion,
    scope,
    instructions: [
      '只修改 proposed、reason 與 action；不要修改 target、base 或 current。',
      '需要提出修改時將 action 設為 propose；需要隱藏時設為 hide；不處理則保留 unchanged。',
      'proposed 必須保留完整欄位；tagNames 使用既有標籤名稱。',
    ],
    items,
  };
  if (c.req.query('format') === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="board-game-rules-review-${new Date(timestamp).toISOString().slice(0, 10)}.csv"`);
    return c.body(serializeReviewCsv(file));
  }
  c.header('Content-Disposition', `attachment; filename="board-game-rules-review-${new Date(timestamp).toISOString().slice(0, 10)}.json"`);
  return c.json(file);
});

const reviewImportSchema = z.union([
  z.object({ file: z.unknown() }),
  z.object({ format: z.literal('csv'), content: z.string().min(1).max(3 * 1024 * 1024) }),
]);
reviewRoutes.post('/api/admin/review/import', requireRole('admin'), async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 3 * 1024 * 1024) return c.json({ error: 'request_too_large' }, 413);
  const body = reviewImportSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: 'invalid_review_file' }, 400);
  let reviewInput: unknown;
  try {
    reviewInput = 'content' in body.data ? parseReviewCsv(body.data.content) : body.data.file;
  } catch {
    return c.json({ error: 'invalid_review_file' }, 400);
  }
  const parsed = reviewFileSchema.safeParse(reviewInput);
  if (!parsed.success) return c.json({ error: 'invalid_review_file', issues: parsed.error.issues }, 400);
  const sourceHash = await sha256Hex(JSON.stringify(parsed.data));
  const existing = await getDatabase(c).statement('SELECT id, proposal_count FROM review_batches WHERE source_hash = ?')
    .bind(sourceHash).first<{ id: string; proposal_count: number }>();
  if (existing) return c.json({ batchId: existing.id, imported: existing.proposal_count, reused: true });

  const candidates = parsed.data.items.filter((item) =>
    item.action !== 'unchanged' && (item.action === 'hide' || !sameReviewContent(item.current, item.proposed)));
  const targetIds = Array.from(new Set(candidates.map((item) => item.target.id)));
  const currentRows = new Map<string, ReviewRuleRow>();
  for (let index = 0; index < targetIds.length; index += 50) {
    const ids = targetIds.slice(index, index + 50);
    if (!ids.length) continue;
    const result = await getDatabase(c).statement(`${reviewRuleSelect}
      WHERE r.id IN (${ids.map(() => '?').join(',')})
    `).bind(...ids).all<ReviewRuleRow>();
    for (const row of result.results ?? []) currentRows.set(row.id, row);
  }

  const timestamp = now();
  const user = c.get('user')!;
  const batchId = createId('review_batch');
  const proposals: Array<{
    id: string; item: (typeof candidates)[number]; status: 'pending' | 'conflict';
    original: ReviewContent; proposed: ReviewContent;
  }> = [];
  let skipped = 0;
  for (const item of candidates) {
    const row = currentRows.get(item.target.id);
    if (!row) { skipped += 1; continue; }
    const original = reviewContentFromRow(row);
    const proposed = normalizedReviewContent({
      ...item.proposed,
      categories: item.proposed.categories ?? original.categories,
    });
    if (item.action !== 'hide' && sameReviewContent(original, proposed)) { skipped += 1; continue; }
    const currentHash = await reviewContentHash(original);
    proposals.push({
      id: createId('review'),
      item,
      status: row.updated_at === item.base.updatedAt && currentHash === item.base.contentHash ? 'pending' : 'conflict',
      original,
      proposed,
    });
  }
  await getDatabase(c).statement(`
    INSERT INTO review_batches (
      id, name, source_type, source_hash, base_dataset_version, scope_json,
      proposal_count, pending_count, created_by, created_at, updated_at
    ) VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    batchId, parsed.data.name, sourceHash, parsed.data.datasetVersion,
    JSON.stringify(parsed.data.scope), proposals.length,
    proposals.filter((proposal) => proposal.status === 'pending').length,
    user.id, timestamp, timestamp,
  ).run();
  try {
    for (let index = 0; index < proposals.length; index += 50) {
      const statements = proposals.slice(index, index + 50).map(({ id, item, status, original, proposed }) =>
        getDatabase(c).statement(`
          INSERT INTO review_proposals (
            id, batch_id, target_id, operation, status, reason,
            base_updated_at, base_content_hash, original_json, proposed_json,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, batchId, item.target.id, item.action === 'hide' ? 'hide' : 'edit', status, item.reason || null,
          item.base.updatedAt, item.base.contentHash, JSON.stringify(original), JSON.stringify(proposed),
          user.id, timestamp, timestamp,
        ));
      await getDatabase(c).batch(statements);
    }
  } catch (error) {
    await getDatabase(c).batch([
      getDatabase(c).statement('DELETE FROM review_proposals WHERE batch_id = ?').bind(batchId),
      getDatabase(c).statement('DELETE FROM review_batches WHERE id = ?').bind(batchId),
    ]);
    throw error;
  }
  return c.json({ batchId, imported: proposals.length, skipped });
});

reviewRoutes.get('/api/admin/review/batches', requireRole('admin'), async (c) => {
  const result = await getDatabase(c).statement(`
    SELECT b.id, b.name, b.source_type, b.status, b.base_dataset_version, b.proposal_count, b.pending_count,
      b.accepted_count, b.rejected_count,
      b.created_by, b.created_at, b.updated_at, COALESCE(u.nickname, u.display_name) created_by_name
    FROM review_batches b JOIN users u ON u.id = b.created_by
    ORDER BY b.created_at DESC
  `).all<{
    id: string; name: string; source_type: string; status: ReviewBatch['status']; base_dataset_version: string | null;
    proposal_count: number; pending_count: number; accepted_count: number; rejected_count: number; created_by: string; created_at: number;
    updated_at: number; created_by_name: string | null;
  }>();
  setNoCache(c);
  return c.json({
    batches: (result.results ?? []).map((row): ReviewBatch => ({
      id: row.id,
      name: row.name,
      sourceType: row.source_type as ReviewBatch['sourceType'],
      status: row.status,
      proposalCount: row.proposal_count,
      pendingCount: row.pending_count,
      acceptedCount: row.accepted_count,
      rejectedCount: row.rejected_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

reviewRoutes.get('/api/admin/review/proposals', requireRole('admin'), async (c) => {
  const status = c.req.query('status') as ReviewProposal['status'] | undefined;
  const batchId = (c.req.query('batchId') ?? '').trim();
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const cursor = (c.req.query('cursor') ?? '').trim();

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (status) {
    conditions.push('p.status = ?');
    bindings.push(status);
  }
  if (batchId) {
    conditions.push('p.batch_id = ?');
    bindings.push(batchId);
  }
  if (cursor) {
    conditions.push('p.id < ?');
    bindings.push(cursor);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await getDatabase(c).statement(`
    SELECT p.id, p.batch_id, p.target_id, p.operation, p.status, p.reason,
      p.base_updated_at, p.base_content_hash, p.original_json, p.proposed_json,
      p.claimed_by, p.claimed_until, p.version, p.created_at, p.updated_at,
      g.display_name game_name, g.slug game_slug,
      COALESCE(u1.nickname, u1.display_name) created_by_name
    FROM review_proposals p
    JOIN rules r ON r.id = p.target_id
    JOIN games g ON g.id = r.game_id
    LEFT JOIN users u1 ON u1.id = p.created_by
    ${whereClause}
    ORDER BY p.id DESC
    LIMIT ?
  `).bind(...bindings, limit + 1).all<{
    id: string; batch_id: string; target_id: string; operation: 'edit' | 'hide'; status: ReviewProposal['status'];
    reason: string | null; base_updated_at: number; base_content_hash: string; original_json: string;
    proposed_json: string; claimed_by: string | null; claimed_until: number | null; version: number;
    created_at: number; updated_at: number; game_name: string; game_slug: string; created_by_name: string | null;
  }>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  setNoCache(c);
  return c.json({
    proposals: items.map((row): ReviewProposal => {
      const original = normalizedReviewContent(JSON.parse(row.original_json) as ReviewContent);
      const proposedInput = JSON.parse(row.proposed_json) as ReviewContent;
      return {
        id: row.id,
        batchId: row.batch_id,
        targetId: row.target_id,
        gameId: '',
        gameName: row.game_name,
        gameSlug: row.game_slug,
        operation: row.operation,
        status: row.status as ReviewProposal['status'],
        reason: row.reason ?? undefined,
        baseUpdatedAt: row.base_updated_at,
        original,
        proposed: normalizedReviewContent({
          ...proposedInput,
          categories: proposedInput.categories ?? original.categories,
        }),
        version: row.version,
        claimedBy: row.claimed_by ?? undefined,
        claimedUntil: row.claimed_until ?? undefined,
        createdAt: row.created_at,
      };
    }),
    nextCursor: hasMore ? items[items.length - 1].id : undefined,
  });
});

const decisionSchema = z.object({
  decisions: z.array(z.object({
    proposalId: z.string(),
    version: z.number().int().positive(),
    decision: z.enum(['accept', 'reject']),
    proposed: reviewContentSchema.optional(),
  })).min(1).max(100),
});
reviewRoutes.post('/api/admin/review/decisions', requireRole('admin'), async (c) => {
  const body = decisionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: 'invalid_payload' }, 400);

  const proposalIds = body.data.decisions.map((decision) => decision.proposalId);
  const result = await getDatabase(c).statement(`
    SELECT p.id, p.batch_id, p.target_id, p.operation, p.status, p.base_updated_at,
      p.proposed_json, p.version, r.game_id, r.updated_at rule_updated_at, g.slug game_slug
    FROM review_proposals p
    JOIN rules r ON r.id = p.target_id
    JOIN games g ON g.id = r.game_id
    WHERE p.id IN (${proposalIds.map(() => '?').join(',')})
  `).bind(...proposalIds).all<{
    id: string; batch_id: string; target_id: string; operation: 'edit' | 'hide'; status: ReviewProposal['status'];
    base_updated_at: number; proposed_json: string; version: number; game_id: string;
    rule_updated_at: number; game_slug: string;
  }>();

  const proposals = new Map((result.results ?? []).map((row) => [row.id, row]));
  const user = c.get('user')!;
  const timestamp = now();
  const statements: DatabaseStatement[] = [];
  const affectedBatches = new Set<string>();
  const affectedGameSlugs = new Set<string>();
  const outcomes: Array<{ proposalId: string; status: string }> = [];

  for (const decision of body.data.decisions) {
    const row = proposals.get(decision.proposalId);
    if (!row || row.version !== decision.version) {
      outcomes.push({ proposalId: decision.proposalId, status: 'stale' });
      continue;
    }
    if (row.status !== 'pending' && row.status !== 'conflict') {
      outcomes.push({ proposalId: decision.proposalId, status: row.status });
      continue;
    }
    affectedBatches.add(row.batch_id);

    if (decision.decision === 'reject') {
      statements.push(getDatabase(c).statement(`
        UPDATE review_proposals
        SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).bind(user.id, timestamp, timestamp, row.id, row.version));
      outcomes.push({ proposalId: row.id, status: 'rejected' });
      continue;
    }

    if (row.rule_updated_at !== row.base_updated_at) {
      statements.push(getDatabase(c).statement(`
        UPDATE review_proposals SET status = 'conflict', version = version + 1, updated_at = ? WHERE id = ? AND version = ?
      `).bind(timestamp, row.id, row.version));
      outcomes.push({ proposalId: row.id, status: 'stale' });
      continue;
    }

    affectedGameSlugs.add(row.game_slug);
    if (row.operation === 'hide') {
      statements.push(
        getDatabase(c).statement(`
          UPDATE rules SET status = 'hidden', hidden_at = ?, hidden_by = ?, updated_at = ?
          WHERE id = ?
        `).bind(timestamp, user.id, timestamp, row.target_id),
        getDatabase(c).statement(`
          UPDATE review_proposals
          SET status = 'accepted', reviewed_by = ?, reviewed_at = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?
        `).bind(user.id, timestamp, timestamp, row.id, row.version),
      );
      outcomes.push({ proposalId: row.id, status: 'accepted' });
      continue;
    }

    const existingRule = await getDatabase(c).statement(`${reviewRuleSelect} WHERE r.id = ?`).bind(row.target_id).first<ReviewRuleRow>();
    if (!existingRule) {
      outcomes.push({ proposalId: row.id, status: 'stale' });
      continue;
    }
    const currentContent = reviewContentFromRow(existingRule);
    const proposedInput = decision.proposed ?? JSON.parse(row.proposed_json) as ReviewContent;
    const proposed = normalizedReviewContent({
      ...proposedInput,
      categories: proposedInput.categories ?? currentContent.categories,
    });
    const revisionId = createId('rev');
    const editionNotes = proposed.editionNotes ?? (proposed.editionNote ? [proposed.editionNote] : []);

    statements.push(
      getDatabase(c).statement(`
        INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(revisionId, row.target_id, JSON.stringify(currentContent), user.id, 'manual_review', timestamp),
      getDatabase(c).statement(`
        UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, categories_json = ?,
          player_counts_json = ?, edition_notes_json = ?, edition_note = ?,
          source_label = ?, source_url = ?, updated_at = ? WHERE id = ?
      `).bind(
        proposed.statement, proposed.commonMistake || null, proposed.details || null, proposed.flowStage,
        JSON.stringify(proposed.categories ?? []),
        JSON.stringify(proposed.playerCounts ?? []),
        JSON.stringify(editionNotes), editionNotes[0] ?? null,
        proposed.sourceLabel || null, proposed.sourceUrl || null, timestamp, row.target_id,
      ),
      getDatabase(c).statement(`
        UPDATE review_proposals
        SET status = 'accepted', proposed_json = ?, reviewed_by = ?, reviewed_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).bind(JSON.stringify(proposed), user.id, timestamp, timestamp, row.id, row.version),
      getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id),
    );

    statements.push(...await tagWriteStatements(c, row.target_id, cleanTagNames(proposed.tagNames), user.id, timestamp));
    outcomes.push({ proposalId: row.id, status: 'accepted' });
  }

  if (statements.length) await getDatabase(c).batch(statements);

  for (const batchId of affectedBatches) {
    const counts = await getDatabase(c).statement(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN status IN ('pending', 'conflict') THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) rejected
      FROM review_proposals WHERE batch_id = ?
    `).bind(batchId).first<{ total: number; pending: number; accepted: number; rejected: number }>();
    if (counts) {
      await getDatabase(c).statement(`
        UPDATE review_batches SET proposal_count = ?, pending_count = ?, accepted_count = ?, rejected_count = ?,
          status = CASE WHEN ? = 0 THEN 'completed' ELSE 'open' END,
          completed_at = CASE WHEN ? = 0 THEN ? ELSE NULL END, updated_at = ? WHERE id = ?
      `).bind(counts.total, counts.pending, counts.accepted, counts.rejected,
        counts.pending, counts.pending, timestamp, timestamp, batchId).run();
    }
  }

  if (affectedGameSlugs.size) {
    const cache = (caches as any).default;
    c.executionCtx.waitUntil(Promise.all([
      ...[...affectedGameSlugs].map((slug) => cache.delete(new Request(new URL(`/api/games/${slug}`, c.req.url)))),
      cache.delete(new Request(new URL('/api/home', c.req.url))),
    ]));
  }
  return c.json({ outcomes });
});

export default reviewRoutes;
