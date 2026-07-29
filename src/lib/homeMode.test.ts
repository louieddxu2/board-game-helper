import { afterEach, describe, expect, test } from 'vitest';
import { HOME_MODE_STORAGE_KEY, readHomeMode, resolveHomeMode, writeHomeMode } from './homeMode';

afterEach(() => localStorage.clear());

describe('home mode preference', () => {
  test('forces exploration until the account has a favorite', () => {
    writeHomeMode('personal');
    expect(resolveHomeMode(0)).toBe('explore');
  });

  test('defaults accounts with favorites to the personal home', () => {
    expect(resolveHomeMode(1)).toBe('personal');
  });

  test('preserves an explicit exploration choice once favorites exist', () => {
    writeHomeMode('explore');
    expect(readHomeMode()).toBe('explore');
    expect(resolveHomeMode(3)).toBe('explore');
    expect(localStorage.getItem(HOME_MODE_STORAGE_KEY)).toBe('explore');
  });
});
