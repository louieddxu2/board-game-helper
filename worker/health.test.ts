import { describe, expect, test, vi } from 'vitest';
import app from './index';
import type { Env } from './env';

describe('worker health endpoint', () => {
  test('reports availability without touching D1', async () => {
    const prepare = vi.fn();
    const env = {
      DB: { prepare, batch: vi.fn() },
      PUBLIC_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
      WRITE_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    } as unknown as Env;

    const response = await app.request('https://rules.example/api/health', {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(prepare).not.toHaveBeenCalled();
  });
});
