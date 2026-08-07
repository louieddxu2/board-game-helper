import { describe, expect, test } from 'vitest';
import { isSafeExternalUrl, parseSafeExternalUrl } from './externalUrl';

describe('external source URL policy', () => {
  test('allows HTTPS URLs and normalizes their display form', () => {
    expect(isSafeExternalUrl(' https://example.com/rules ')).toBe(true);
    expect(parseSafeExternalUrl(' https://example.com/rules ')?.href).toBe('https://example.com/rules');
  });

  test('rejects active or ambiguous URL schemes', () => {
    for (const value of ['http://example.com/rules', 'javascript:alert(1)', 'data:text/html,unsafe', 'not-a-url']) {
      expect(isSafeExternalUrl(value)).toBe(false);
    }
  });

  test('rejects URLs carrying credentials', () => {
    expect(isSafeExternalUrl('https://user:password@example.com/rules')).toBe(false);
  });
});
