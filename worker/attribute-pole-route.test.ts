import { afterEach, expect, test, vi } from 'vitest';
import { attributesRoutes } from './routes/attributes';
import { queryAttributeQuestionPayload } from './data/attributes';
import { verifyAttributeQuestionToken } from './utils';

vi.mock('./data/database', () => ({ getDatabase: () => ({}) }));
vi.mock('./data/attributes', () => ({ queryAttributeQuestionPayload: vi.fn(), saveAttributeResponse: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

test.each([
  { random: 0.1, query: '', expected: 'low' },
  { random: 0.9, query: '', expected: 'high' },
  { random: 0.9, query: '&fixedAttribute=win&fixedB=b&highPole=low', expected: 'low' },
  { random: 0.1, query: '&fixedAttribute=win&fixedA=a&highPole=high', expected: 'high' },
  { random: 0.9, query: '&highPole=low', expected: 'high' },
] as const)('issues and signs the expected direction: $expected / $query', async ({ random, query, expected }) => {
  vi.spyOn(Math, 'random').mockReturnValue(random);
  const attribute = { id: 'win', key: 'win', name: '取勝方式', minValue: 0, maxValue: 10, sortOrder: 0, scaleType: 'bipolar' as const,
    endpoints: { low: { label: '得分', question: '得分？' }, high: { label: '條件', question: '條件？' } } };
  const subject = { id: 'a', slug: 'a', kind: 'game' as const, displayName: 'A' };
  vi.mocked(queryAttributeQuestionPayload).mockResolvedValue({ question: { attribute, subjectA: subject, subjectB: { ...subject, id: 'b' } }, activities: [] });
  const secret = 'isolated-test-secret-not-for-production-123456';
  const response = await attributesRoutes.request(`https://example.test/api/attributes/question?session=session-123${query}`, {}, { ATTRIBUTE_QUESTION_SECRET: secret });
  expect(response.status).toBe(200);
  const payload = await response.json() as { question: { highPole: 'low' | 'high' }; questionToken: string };
  expect(payload.question.highPole).toBe(expected);
  const identity = { sessionId: 'session-123', attributeId: 'win', subjectAId: 'a', subjectBId: 'b' };
  expect(await verifyAttributeQuestionToken(payload.questionToken, { ...identity, highPole: expected }, secret)).toBe(true);
  expect(await verifyAttributeQuestionToken(payload.questionToken, { ...identity, highPole: expected === 'low' ? 'high' : 'low' }, secret)).toBe(false);
});
