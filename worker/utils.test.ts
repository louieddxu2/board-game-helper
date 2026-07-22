import { describe, expect, test } from 'vitest';
import { assertMutationOrigin, cleanOptional, normalizeEmail, normalizeText, slugify } from './utils';

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

  test('accepts same-origin mutations and rejects unrelated origins', () => {
    const req = (origin?: string) => ({ req: { url: 'https://rules.example.com/api/rules', header: () => origin }, env: { APP_ORIGIN: 'https://rules.example.com' } });
    expect(assertMutationOrigin(req('https://rules.example.com'))).toBe(true);
    expect(assertMutationOrigin(req('https://attacker.example'))).toBe(false);
    expect(assertMutationOrigin(req())).toBe(true);
  });
});
