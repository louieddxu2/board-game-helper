import { describe, expect, test } from 'vitest';
import { submissionSchema } from './routes/submissions';

const base = {
  idempotencyKey: 'request-1234',
  rules: [{ statement: 'A rule' }],
};

describe('contribution submission contract', () => {
  test('accepts exactly one existing or new game target', () => {
    expect(submissionSchema.safeParse({ ...base, gameId: 'game-1' }).success).toBe(true);
    expect(submissionSchema.safeParse({ ...base, newGame: { displayName: 'New game' } }).success).toBe(true);
    expect(submissionSchema.safeParse(base).success).toBe(false);
    expect(submissionSchema.safeParse({ ...base, gameId: 'game-1', newGame: { displayName: 'New game' } }).success).toBe(false);
  });

  test('requires a new game to be submitted with at least one rule', () => {
    expect(submissionSchema.safeParse({
      ...base,
      newGame: { displayName: 'New game' },
      rules: [],
    }).success).toBe(false);
  });

  test('drops the removed play-date and private-note fields from new submissions', () => {
    const parsed = submissionSchema.parse({
      ...base,
      gameId: 'game-1',
      playedOn: '2026-08-02',
      privateNote: 'legacy private note',
    });
    expect(parsed).not.toHaveProperty('playedOn');
    expect(parsed).not.toHaveProperty('privateNote');
  });

  test('keeps the trusted editor batch boundary at twenty rules', () => {
    expect(submissionSchema.safeParse({ ...base, gameId: 'game-1', rules: Array.from({ length: 20 }, (_, index) => ({ statement: `Rule ${index}` })) }).success).toBe(true);
    expect(submissionSchema.safeParse({ ...base, gameId: 'game-1', rules: Array.from({ length: 21 }, (_, index) => ({ statement: `Rule ${index}` })) }).success).toBe(false);
  });
});
