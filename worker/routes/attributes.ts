import { Hono } from 'hono';
import { z } from 'zod';
import { ATTRIBUTE_COMPARISON_RESULTS } from '../../src/shared/types';
import { getDatabase } from '../data/database';
import {
  queryAttributeWorkbench,
  queryAttributesPayload,
  saveAttributeComparison,
  saveAttributeRating,
} from '../data/attributes';
import type { RouteEnv } from '../env';
import type { AppVariables } from '../auth';
import { now } from '../utils';

const attributesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

const sessionIdSchema = z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/);

const workbenchQuerySchema = z.object({
  subjectA: z.string().trim().min(1).max(200),
  subjectB: z.string().trim().min(1).max(200),
  attributeId: z.string().trim().min(1).max(200),
  sessionId: sessionIdSchema,
});

const ratingSchema = z.object({
  subjectId: z.string().trim().min(1).max(200),
  attributeId: z.string().trim().min(1).max(200),
  value: z.number().int().min(0).max(10),
  sessionId: sessionIdSchema,
});

const comparisonSchema = z.object({
  subjectAId: z.string().trim().min(1).max(200),
  subjectBId: z.string().trim().min(1).max(200),
  attributeId: z.string().trim().min(1).max(200),
  result: z.enum(ATTRIBUTE_COMPARISON_RESULTS),
  sessionId: sessionIdSchema,
});

const respondWithAttributeError = (c: any, error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'attribute_not_found' || message === 'attribute_subject_not_found') return c.json({ error: message }, 404);
  if (message === 'attribute_subjects_must_differ') return c.json({ error: message }, 400);
  throw error;
};

attributesRoutes.get('/api/attributes', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await queryAttributesPayload(getDatabase(c)));
});

attributesRoutes.get('/api/attributes/workbench', async (c) => {
  const parsed = workbenchQuerySchema.safeParse({
    subjectA: c.req.query('a'),
    subjectB: c.req.query('b'),
    attributeId: c.req.query('attribute'),
    sessionId: c.req.query('session'),
  });
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  try {
    c.header('Cache-Control', 'no-store');
    return c.json(await queryAttributeWorkbench(
      getDatabase(c),
      parsed.data.subjectA,
      parsed.data.subjectB,
      parsed.data.attributeId,
      parsed.data.sessionId,
    ));
  } catch (error) {
    return respondWithAttributeError(c, error);
  }
});

attributesRoutes.post('/api/attributes/ratings', async (c) => {
  const parsed = ratingSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  try {
    await saveAttributeRating(
      getDatabase(c),
      parsed.data.subjectId,
      parsed.data.attributeId,
      parsed.data.value,
      parsed.data.sessionId,
      c.get('user')?.id ?? null,
      now(),
    );
    return c.json({ ok: true });
  } catch (error) {
    return respondWithAttributeError(c, error);
  }
});

attributesRoutes.post('/api/attributes/comparisons', async (c) => {
  const parsed = comparisonSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  try {
    await saveAttributeComparison(
      getDatabase(c),
      parsed.data.subjectAId,
      parsed.data.subjectBId,
      parsed.data.attributeId,
      parsed.data.result,
      parsed.data.sessionId,
      c.get('user')?.id ?? null,
      now(),
    );
    return c.json({ ok: true });
  } catch (error) {
    return respondWithAttributeError(c, error);
  }
});

export { attributesRoutes };
