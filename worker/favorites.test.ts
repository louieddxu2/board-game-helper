import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { addFavorite, FavoriteLimitError, queryPersonalHome } from './data/favorites';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

describe('favorite home data', () => {
  test('maps favorites with public unread state and keeps recent games distinct', async () => {
    const favorites = statement({ all: vi.fn().mockResolvedValue({ results: [{
      id: 'g1', slug: 'agricola', display_name: '農家樂', seen_rule_updated_at: 10,
      latest_rule_id: 'r1', latest_rule_statement: '新規則', latest_rule_updated_at: 20,
    }] }) });
    const recent = statement({ all: vi.fn().mockResolvedValue({ results: [
      { id: 'g1', slug: 'agricola', display_name: '農家樂', latest_rule_id: 'r1', latest_rule_statement: '新規則', latest_rule_updated_at: 20 },
      { id: 'g2', slug: 'splendor', display_name: '璀璨寶石', latest_rule_id: 'r2', latest_rule_statement: '另一條', latest_rule_updated_at: 19 },
    ] }) });
    const db = { statement: vi.fn().mockReturnValueOnce(favorites).mockReturnValueOnce(recent), batch: vi.fn() } as unknown as Database;

    const payload = await queryPersonalHome(db, 'u1');

    expect(payload.favorites[0]).toMatchObject({ id: 'g1', hasUpdates: true, latestRule: { id: 'r1' } });
    expect(payload.recentUpdates.map((game) => game.id)).toEqual(['g1', 'g2']);
    expect(db.statement).toHaveBeenCalledWith(expect.stringMatching(/FROM game_public_rule_heads head/));
    expect(db.statement).not.toHaveBeenCalledWith(expect.stringMatching(/ROW_NUMBER|FROM rules r\s+WHERE r\.status/));
  });

  test('still provides bounded recent updates for an account without favorites', async () => {
    const favorites = statement({ all: vi.fn().mockResolvedValue({ results: [] }) });
    const recent = statement({ all: vi.fn().mockResolvedValue({ results: [{
      id: 'g2', slug: 'splendor', display_name: '璀璨寶石', latest_rule_id: 'r2',
      latest_rule_statement: '拿取寶石後不得超過十枚。', latest_rule_updated_at: 19,
    }] }) });
    const db = { statement: vi.fn().mockReturnValueOnce(favorites).mockReturnValueOnce(recent), batch: vi.fn() } as unknown as Database;

    await expect(queryPersonalHome(db, 'u1')).resolves.toMatchObject({
      favorites: [], recentUpdates: [{ id: 'g2', hasUpdates: false }],
    });
    expect(db.statement).toHaveBeenCalledTimes(2);
  });

  test('initializes the first favorite at the latest public rule version', async () => {
    const game = statement({ first: vi.fn().mockResolvedValue({ id: 'g1', current_version: 22 }) });
    const existing = statement({ first: vi.fn().mockResolvedValue(null) });
    const count = statement({ first: vi.fn().mockResolvedValue({ count: 0 }) });
    const insert = statement({ run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) });
    const db = { statement: vi.fn()
      .mockReturnValueOnce(game).mockReturnValueOnce(existing).mockReturnValueOnce(count).mockReturnValueOnce(insert), batch: vi.fn() } as unknown as Database;

    await expect(addFavorite(db, 'u1', 'g1', 100)).resolves.toEqual({ favorite: true, favoriteCount: 1, wasFirst: true });
    expect(insert.bind).toHaveBeenCalledWith('u1', 'g1', 22, 100);
  });

  test('rejects a seventh favorite without writing', async () => {
    const game = statement({ first: vi.fn().mockResolvedValue({ id: 'g7', current_version: 1 }) });
    const existing = statement({ first: vi.fn().mockResolvedValue(null) });
    const count = statement({ first: vi.fn().mockResolvedValue({ count: 6 }) });
    const db = { statement: vi.fn().mockReturnValueOnce(game).mockReturnValueOnce(existing).mockReturnValueOnce(count), batch: vi.fn() } as unknown as Database;

    await expect(addFavorite(db, 'u1', 'g7', 100)).rejects.toBeInstanceOf(FavoriteLimitError);
    expect(db.statement).toHaveBeenCalledTimes(3);
  });
});
