import { Hono } from 'hono';
import { z } from 'zod';
import { ATTRIBUTE_COMPARISON_RESULTS } from '../../src/shared/types';
import { getDatabase } from '../data/database';
import {
  queryAttributeQuestionPayload,
  saveAttributeResponse,
} from '../data/attributes';
import {
  attributeCatalogChangesPayload,
  attributeCatalogPayload,
  ATTRIBUTE_CATALOG_CHANGE_LIMIT,
  queryAttributeCatalogChanges,
  queryAttributeCatalogSnapshot,
} from '../data/attributeCatalog';
import type { AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { now, signAttributeQuestionToken, verifyAttributeQuestionToken } from '../utils';
import { logD1Query } from './shared';

const attributesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

const sessionIdSchema = z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/);

const questionQuerySchema = z.object({
  sessionId: sessionIdSchema,
  excludeSubjectAId: z.string().trim().max(200).optional(),
  excludeSubjectBId: z.string().trim().max(200).optional(),
  excludeAttributeId: z.string().trim().max(200).optional(),
  fixedSubjectAId: z.string().trim().max(200).optional(),
  fixedSubjectBId: z.string().trim().max(200).optional(),
  fixedAttributeId: z.string().trim().max(200).optional(),
});

export const attributeResponseSchema = z.object({
  subjectAId: z.string().trim().min(1).max(200),
  subjectBId: z.string().trim().min(1).max(200),
  attributeId: z.string().trim().min(1).max(200),
  responseId: sessionIdSchema,
  questionToken: z.string().trim().min(32).max(512),
  comparison: z.enum(ATTRIBUTE_COMPARISON_RESULTS).nullable().optional(),
  ratingA: z.number().int().min(0).max(10).nullable().optional(),
  ratingB: z.number().int().min(0).max(10).nullable().optional(),
  sessionId: sessionIdSchema,
}).refine((input) => input.comparison != null || input.ratingA != null || input.ratingB != null, { message: 'attribute_response_empty' });

const respondWithAttributeError = (c: any, error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'attribute_not_found' || message === 'attribute_subject_not_found') return c.json({ error: message }, 404);
  if (message === 'attribute_subjects_must_differ' || message === 'attribute_response_empty' || message === 'attribute_question_invalid') return c.json({ error: message }, 400);
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
  const db = getDatabase(c);
  try {
    c.header('Cache-Control', 'no-store');
    const result = logD1Query(c, 'attribute_catalog_changes', await queryAttributeCatalogChanges(db, after, ATTRIBUTE_CATALOG_CHANGE_LIMIT));
    const payload = attributeCatalogChangesPayload(result, after, ATTRIBUTE_CATALOG_CHANGE_LIMIT);
    setD1MetricsHeader(c, db);
    return c.json(payload);
  } catch (error) {
    setD1MetricsHeader(c, db);
    return respondWithAttributeError(c, error);
  }
});

attributesRoutes.get('/api/attributes/question', async (c) => {
  const parsed = questionQuerySchema.safeParse({
    sessionId: c.req.query('session'),
    excludeSubjectAId: c.req.query('excludeA') || undefined,
    excludeSubjectBId: c.req.query('excludeB') || undefined,
    excludeAttributeId: c.req.query('excludeAttribute') || undefined,
    fixedSubjectAId: c.req.query('fixedA') || undefined,
    fixedSubjectBId: c.req.query('fixedB') || undefined,
    fixedAttributeId: c.req.query('fixedAttribute') || undefined,
  });
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const db = getDatabase(c);
  try {
    c.header('Cache-Control', 'no-store');
    const payload = await queryAttributeQuestionPayload(db, parsed.data.sessionId, parsed.data);
    setD1MetricsHeader(c, db);
    if (!payload.question) return c.json(payload);
    const questionToken = await signAttributeQuestionToken({
      sessionId: parsed.data.sessionId,
      attributeId: payload.question.attribute.id,
      subjectAId: payload.question.subjectA.id,
      subjectBId: payload.question.subjectB.id,
    }, c.env.ATTRIBUTE_QUESTION_SECRET ?? c.env.EMAIL_HASH_SECRET);
    return c.json({ ...payload, questionToken });
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
    const validQuestion = await verifyAttributeQuestionToken(parsed.data.questionToken, {
      sessionId: parsed.data.sessionId,
      attributeId: parsed.data.attributeId,
      subjectAId: parsed.data.subjectAId,
      subjectBId: parsed.data.subjectBId,
    }, c.env.ATTRIBUTE_QUESTION_SECRET ?? c.env.EMAIL_HASH_SECRET);
    if (!validQuestion) return c.json({ error: 'attribute_question_invalid' }, 400);
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
