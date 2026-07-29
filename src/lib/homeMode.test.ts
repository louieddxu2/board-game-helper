import { afterEach, describe, expect, test } from 'vitest';
import { HOME_MODE_STORAGE_KEY, readHomeMode, resolveHomeMode, writeHomeMode } from './homeMode';

afterEach(() => localStorage.clear());

describe('home mode preference', () => {
  test('defaults an account without favorites to exploration', () => {
    expect(resolveHomeMode(0)).toBe('explore');
  });

  test('preserves a personal-home choice without favorites', () => {
    writeHomeMode('personal');
    expect(resolveHomeMode(0)).toBe('personal');
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
