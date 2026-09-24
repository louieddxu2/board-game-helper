import { describe, expect, test } from 'vitest';
import { assertMutationOrigin, cleanAliases, cleanOptional, hashEmail, isValidNickname, legacyHashEmail, normalizeEmail, normalizeNickname, normalizeText, slugify, trustedOrigins } from './utils';

describe('worker utilities', () => {
  test('normalizes names and email consistently', () => {
    expect(normalizeText(' Smartphone Inc. 手機帝國 ')).toBe('smartphoneinc手機帝國');
    expect(normalizeEmail(' Louie@example.COM ')).toBe('louie@example.com');
  });

  test('protects email identity with a secret-key HMAC', async () => {
    const secret = 'test-email-hmac-secret-at-least-32-characters';
    const first = await hashEmail('Editor@Example.com', secret);
    const second = await hashEmail(' editor@example.COM ', secret);
    expect(first).toBe(second);
    expect(first).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(await legacyHashEmail('Editor@Example.com')).not.toBe(first);
    await expect(hashEmail('editor@example.com', 'too-short')).rejects.toThrow('email_hash_secret_not_configured');
  });

  test('creates readable slugs and trims optional fields', () => {
    expect(slugify('Whistle Mountain 汽笛山脈')).toBe('whistle-mountain-汽笛山脈');
    expect(cleanOptional('  abcdef  ', 3)).toBe('abc');
    expect(cleanOptional('   ', 10)).toBeUndefined();
  });

  test('keeps only distinct aliases that differ from canonical names', () => {
    expect(cleanAliases(
      ['盛譽學園', 'Alma Mater', 'Alma-Mater', '學園盛譽', ' 學園盛譽 '],
      '盛譽學園',
      'Alma Mater',
    )).toEqual(['學園盛譽']);
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
