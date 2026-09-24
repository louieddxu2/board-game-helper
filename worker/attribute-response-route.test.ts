import { afterEach, expect, test, vi } from 'vitest';
import { attributesRoutes } from './routes/attributes';
import { saveAttributeResponse } from './data/attributes';

vi.mock('./data/database', () => ({ getDatabase: () => ({}) }));
vi.mock('./data/attributes', () => ({ saveAttributeResponse: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

test('accepts locally selected offline votes without a question token', async () => {
  vi.mocked(saveAttributeResponse).mockResolvedValue({ updatedValues: [], activities: [] });
  const response = await attributesRoutes.request('https://example.test/api/attributes/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subjectAId: 'a', subjectBId: 'b', attributeId: 'score', responseId: 'response-123',
      sessionId: 'session-123', comparison: 'SIMILAR',
    }),
  });

  expect(response.status).toBe(200);
  expect(saveAttributeResponse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    subjectAId: 'a', subjectBId: 'b', attributeId: 'score', comparison: 'SIMILAR',
  }));
});
