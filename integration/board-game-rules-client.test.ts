import { afterEach, describe, expect, test, vi } from 'vitest';
import { BoardGameRulesClient } from './board-game-rules-client';

afterEach(() => vi.unstubAllGlobals());

describe('BoardGameRulesClient', () => {
  test('exchanges a Google ID token and uses the short-lived bearer session for writes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: 'rules-session',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 60_000,
        user: { id: 'user-1', email: 'editor@example.com', roles: ['editor'] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        submissionId: 'sub-1',
        ruleIds: ['rule-1'],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BoardGameRulesClient({ baseUrl: 'https://rules.example.com/' });
    await client.exchangeGoogleCredential('google-id-token');
    await client.submit({
      gameId: 'game-1',
      idempotencyKey: 'request-123',
      rules: [{ statement: '正確規則' }],
    });

    const exchange = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(exchange[0]).toBe('https://rules.example.com/api/auth/google/exchange');
    expect(new Headers(exchange[1].headers).has('Authorization')).toBe(false);
    const writeHeaders = new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers);
    expect(writeHeaders.get('Authorization')).toBe('Bearer rules-session');
  });

  test('keeps public reads anonymous so CDN responses remain shareable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ games: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BoardGameRulesClient({
      baseUrl: 'https://rules.example.com',
      getAccessToken: () => 'rules-session',
    });

    await client.searchGames('農家樂');

    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  test('revalidates a cached public snapshot without redownloading it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 304,
      headers: { ETag: 'W/"v1-123-10-20-5"' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BoardGameRulesClient({ baseUrl: 'https://rules.example.com' });

    const result = await client.publicSnapshot('W/"v1-123-10-20-5"');

    expect(result.unchanged).toBe(true);
    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('If-None-Match')).toBe('W/"v1-123-10-20-5"');
    expect(headers.has('Authorization')).toBe(false);
  });
});
