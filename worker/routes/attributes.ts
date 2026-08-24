import { Hono } from 'hono';
import { z } from 'zod';
import { ATTRIBUTE_COMPARISON_RESULTS } from '../../src/shared/types';
import { getDatabase } from '../data/database';
import { queryAttributeQuestion, queryAttributesPayload, saveAttributeResponse } from '../data/attributes';
import type { AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { now } from '../utils';

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
  comparison: z.enum(ATTRIBUTE_COMPARISON_RESULTS).nullable().optional(),
  ratingA: z.number().int().min(0).max(10).nullable().optional(),
  ratingB: z.number().int().min(0).max(10).nullable().optional(),
  sessionId: sessionIdSchema,
}).refine((input) => input.comparison != null || input.ratingA != null || input.ratingB != null, { message: 'attribute_response_empty' });

const respondWithAttributeError = (c: any, error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'attribute_not_found' || message === 'attribute_subject_not_found') return c.json({ error: message }, 404);
  if (message === 'attribute_subjects_must_differ' || message === 'attribute_response_empty') return c.json({ error: message }, 400);
  throw error;
};

attributesRoutes.get('/api/attributes', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await queryAttributesPayload(getDatabase(c)));
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
  try {
    c.header('Cache-Control', 'no-store');
    return c.json({ question: await queryAttributeQuestion(getDatabase(c), parsed.data.sessionId, parsed.data) });
  } catch (error) {
    return respondWithAttributeError(c, error);
  }
});

attributesRoutes.post('/api/attributes/responses', async (c) => {
  const parsed = attributeResponseSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message === 'attribute_response_empty' ? 'attribute_response_empty' : 'invalid_input' }, 400);
  try {
    await saveAttributeResponse(getDatabase(c), {
      ...parsed.data,
      actorId: c.get('user')?.id ?? null,
      timestamp: now(),
    });
    return c.json({ ok: true });
  } catch (error) {
    return respondWithAttributeError(c, error);
  }
});

export { attributesRoutes };
