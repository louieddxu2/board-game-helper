import { describe, expect, test } from 'vitest';
import { attributesRoutes } from './routes/attributes';

describe('read-only attribute route', () => {
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
});
