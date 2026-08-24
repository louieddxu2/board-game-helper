import { describe, expect, test } from 'vitest';
import { attributesRoutes, attributeResponseSchema } from './routes/attributes';

describe('attribute route', () => {
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
      subjectAId: 'a', subjectBId: 'b', attributeId: 'attribute', sessionId: 'session-123',
    };
    expect(attributeResponseSchema.safeParse(base).success).toBe(false);
    expect(attributeResponseSchema.safeParse({ ...base, responseId: 'response-123' }).success).toBe(false);
    expect(attributeResponseSchema.safeParse({ ...base, responseId: 'response-123', comparison: 'SIMILAR' }).success).toBe(true);
  });
});
