import { describe, expect, test } from 'vitest';
import { assertMutationOrigin, cleanOptional, isValidNickname, normalizeEmail, normalizeNickname, normalizeText, slugify, trustedOrigins } from './utils';

describe('worker utilities', () => {
  test('normalizes names and email consistently', () => {
    expect(normalizeText(' Smartphone Inc. 手機帝國 ')).toBe('smartphoneinc手機帝國');
    expect(normalizeEmail(' Louie@example.COM ')).toBe('louie@example.com');
  });

  test('creates readable slugs and trims optional fields', () => {
    expect(slugify('Whistle Mountain 汽笛山脈')).toBe('whistle-mountain-汽笛山脈');
    expect(cleanOptional('  abcdef  ', 3)).toBe('abc');
    expect(cleanOptional('   ', 10)).toBeUndefined();
  });

  test('validates nickname character and weighted length limits', () => {
    expect(isValidNickname('小明')).toBe(true);
    expect(isValidNickname('abcdefghijkl')).toBe(true);
    expect(isValidNickname('小明abcdefgh')).toBe(true);
    expect(isValidNickname('小明abcdefghi')).toBe(false);
    expect(isValidNickname('abcdefg!')).toBe(false);
    expect(normalizeNickname(' ABCdef ')).toBe('abcdef');
  });

  test('accepts same-origin mutations and rejects unrelated origins', () => {
    const req = (origin?: string) => ({ req: { url: 'https://rules.example.com/api/rules', header: () => origin }, env: { APP_ORIGIN: 'https://rules.example.com', TRUSTED_APP_ORIGINS: 'https://score.example.com, http://localhost:5174/' } });
    expect(assertMutationOrigin(req('https://rules.example.com'))).toBe(true);
    expect(assertMutationOrigin(req('https://score.example.com'))).toBe(true);
    expect(assertMutationOrigin(req('http://localhost:5174'))).toBe(true);
    expect(assertMutationOrigin(req('https://attacker.example'))).toBe(false);
    expect(assertMutationOrigin(req())).toBe(true);
    expect(trustedOrigins(req().env, req().req.url)).toEqual(new Set(['https://rules.example.com', 'https://score.example.com', 'http://localhost:5174']));
  });
});
