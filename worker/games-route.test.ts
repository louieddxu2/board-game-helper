import { describe, expect, test } from 'vitest';
import { gamesRoutes } from './routes/games';

describe('game creation route boundary', () => {
  test('does not expose a standalone endpoint that can create a game without rules', async () => {
    const response = await gamesRoutes.request('https://rules.example/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Empty Game' }),
    });

    expect(response.status).toBe(404);
  });
});
