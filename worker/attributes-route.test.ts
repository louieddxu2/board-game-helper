import { describe, expect, test } from 'vitest';
import { attributesRoutes, attributeResponseSchema } from './routes/attributes';

describe('attribute route', () => {
  test('disables the legacy full-table endpoint without querying D1', async () => {
    const response = await attributesRoutes.request('https://rules.example/api/attributes');

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'attribute_endpoint_disabled' });
  });

  test('does not expose rating or comparison writes', async () => {
    const ratingResponse = await attributesRoutes.request('https://rules.example/api/attributes/ratings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectId: 'subject', attributeId: 'attribute', value: 5, sessionId: 'session-123' }),
    });
    const comparisonResponse = await attributesRoutes.request('https://rules.example/api/attributes/comparisons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subjectAId: 'a', subjectBId: 'b', attributeId: 'attribute', result: 'SIMILAR', sessionId: 'session-123' }),
    });

    expect(ratingResponse.status).toBe(404);
    expect(comparisonResponse.status).toBe(404);
  });

  test('requires a response id and at least one answer in a response', () => {
    const base = {
      subjectAId: 'a', subjectBId: 'b', attributeId: 'attribute', sessionId: 'session-123', questionToken: 'question-token-that-is-long-enough-for-schema',
    };
    expect(attributeResponseSchema.safeParse(base).success).toBe(false);
    expect(attributeResponseSchema.safeParse({ ...base, responseId: 'response-123' }).success).toBe(false);
    expect(attributeResponseSchema.safeParse({ ...base, responseId: 'response-123', comparison: 'SIMILAR' }).success).toBe(true);
  });
});
