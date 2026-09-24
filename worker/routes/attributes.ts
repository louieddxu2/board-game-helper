import { Hono } from 'hono';
import { z } from 'zod';
import { ATTRIBUTE_COMPARISON_RESULTS } from '../../src/shared/types';
import { getDatabase } from '../data/database';
import {
  saveAttributeResponse,
} from '../data/attributes';
import {
  attributeCatalogChangesPayload,
  attributeCatalogPayload,
  ATTRIBUTE_CATALOG_CHANGE_LIMIT,
  queryAttributeCatalogChanges,
  queryAttributeCatalogSnapshot,
  queryAttributeCatalogSnapshotMeta,
} from '../data/attributeCatalog';
import type { AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { now } from '../utils';
import { logD1Query } from './shared';

const attributesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

const sessionIdSchema = z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/);

export const attributeResponseSchema = z.object({
  highPole: z.enum(['low', 'high']).optional(),
  subjectAId: z.string().trim().min(1).max(200),
  subjectBId: z.string().trim().min(1).max(200),
  attributeId: z.string().trim().min(1).max(200),
  responseId: sessionIdSchema,
  comparison: z.enum(ATTRIBUTE_COMPARISON_RESULTS).nullable().optional(),
  ratingA: z.number().int().min(0).max(10).nullable().optional(),
  ratingB: z.number().int().min(0).max(10).nullable().optional(),
  sessionId: sessionIdSchema,
}).refine((input) => input.comparison != null || input.ratingA != null || input.ratingB != null, { message: 'attribute_response_empty' });

const respondWithAttributeError = (c: any, error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'attribute_not_found' || message === 'attribute_subject_not_found') return c.json({ error: message }, 404);
  if (message === 'attribute_subjects_must_differ' || message === 'attribute_response_empty') return c.json({ error: message }, 400);
  if (message === 'attribute_response_busy') return c.json({ error: message }, 409);
  throw error;
};

const setD1MetricsHeader = (c: any, db: ReturnType<typeof getDatabase>) => {
  const metrics = db.metrics?.();
  if (!metrics) return;
  c.header('X-D1-Rows-Read', String(metrics.rowsRead));
  c.header('X-D1-Rows-Written', String(metrics.rowsWritten));
};

attributesRoutes.get('/api/attributes', (c) => {
  // This was the pre-snapshot table endpoint. Keep the path reserved so old
  // bookmarks fail explicitly without reviving its unbounded source query.
  c.header('Cache-Control', 'no-store');
  return c.json({ error: 'attribute_endpoint_disabled' }, 410);
});

attributesRoutes.get('/api/attributes/vote-subjects', (c) => {
  // Collection matching now uses the versioned attribute catalog already
  // cached in the browser. Keep the old URL reserved without touching D1 so
  // stale clients cannot revive the former unbounded directory query.
  c.header('Cache-Control', 'no-store');
  return c.json({ error: 'attribute_vote_subject_directory_disabled' }, 410);
});

attributesRoutes.get('/api/attributes/table', async (c) => {
  const db = getDatabase(c);
  try {
    c.header('Cache-Control', 'no-store');
    const snapshot = await queryAttributeCatalogSnapshot(db);
    // Migration 0051 creates the initial generation. Never fall back to a
    // full source scan on a public request; a missing snapshot is an
    // operational error to repair with the weekly/background rebuild.
    if (!snapshot.state.results?.length) throw new Error('attribute_catalog_unavailable');
    logD1Query(c, 'attribute_catalog_snapshot_state', snapshot.state);
    logD1Query(c, 'attribute_catalog_snapshot_chunks', snapshot.chunks);
    const payload = attributeCatalogPayload(snapshot);
    setD1MetricsHeader(c, db);
    return c.json(payload);
  } catch (error) {
    setD1MetricsHeader(c, db);
    return respondWithAttributeError(c, error);
  }
});

attributesRoutes.get('/api/attributes/table/changes', async (c) => {
  const rawAfter = c.req.query('after') ?? '0';
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: 'invalid_catalog_version' }, 400);
  const rawGeneration = c.req.query('generation');
  const rawGeneratedAt = c.req.query('generatedAt');
  const clientSnapshot = rawGeneration === undefined || rawGeneratedAt === undefined
    ? undefined
    : { generation: Number(rawGeneration), generatedAt: Number(rawGeneratedAt) };
  if ((rawGeneration === undefined) !== (rawGeneratedAt === undefined)
    || (clientSnapshot && (!Number.isSafeInteger(clientSnapshot.generation) || clientSnapshot.generation < 0
      || !Number.isSafeInteger(clientSnapshot.generatedAt) || clientSnapshot.generatedAt < 0))) {
    return c.json({ error: 'invalid_catalog_snapshot' }, 400);
  }
  // Retention removes deltas absorbed by a newer snapshot. A cursor without
  // its baseline identity could otherwise accept an empty response and keep
  // an obsolete browser catalog indefinitely.
  if (!clientSnapshot) return c.json({ error: 'catalog_snapshot_required' }, 409);
  const db = getDatabase(c);
  try {
    c.header('Cache-Control', 'no-store');
    // Read the single active-snapshot row before the delta page.  When a
    // browser carries an obsolete weekly snapshot, its old delta cursor is
    // meaningless; return immediately so no catalog entry rows are read.
    const snapshot = await queryAttributeCatalogSnapshotMeta(db);
    if (clientSnapshot && (clientSnapshot.generation !== snapshot.generation
      || clientSnapshot.generatedAt !== snapshot.generatedAt)) {
      setD1MetricsHeader(c, db);
      return c.json({ changes: [], throughVersion: after, hasMore: false, snapshot });
    }
    const result = await queryAttributeCatalogChanges(db, after, ATTRIBUTE_CATALOG_CHANGE_LIMIT);
    logD1Query(c, 'attribute_catalog_changes', result);
    const payload = attributeCatalogChangesPayload(result, after, snapshot, ATTRIBUTE_CATALOG_CHANGE_LIMIT);
    setD1MetricsHeader(c, db);
    return c.json(payload);
  } catch (error) {
    setD1MetricsHeader(c, db);
    return respondWithAttributeError(c, error);
  }
});

attributesRoutes.post('/api/attributes/responses', async (c) => {
  const parsed = attributeResponseSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message === 'attribute_response_empty' ? 'attribute_response_empty' : 'invalid_input' }, 400);
  const db = getDatabase(c);
  try {
    const result = await saveAttributeResponse(getDatabase(c), {
      ...parsed.data,
      actorId: c.get('user')?.id ?? null,
      timestamp: now(),
    });
    setD1MetricsHeader(c, db);
    return c.json({ ok: true, ...result });
  } catch (error) {
    setD1MetricsHeader(c, db);
    return respondWithAttributeError(c, error);
  }
});

export { attributesRoutes };
