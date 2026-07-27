import { describe, expect, test } from 'vitest';
import { isPublicReadRequest } from './auth';

describe('public read authentication boundary', () => {
  test('keeps ordinary game details on the public fast path', () => {
    expect(isPublicReadRequest('GET', 'https://rules.example/api/games/emberleaf')).toBe(true);
  });

  test('authenticates explicit editor game detail requests', () => {
    expect(isPublicReadRequest('GET', 'https://rules.example/api/games/game-1?includePrivate=1')).toBe(false);
  });

  test('does not classify mutations as public reads', () => {
    expect(isPublicReadRequest('POST', 'https://rules.example/api/games/game-1')).toBe(false);
  });
});
