import { describe, expect, test } from 'vitest';
import { loginHref, loginReturnTo } from './loginNavigation';

describe('login destination', () => {
  test('preserves the original path, encoded game, search, and rule hash', () => {
    const origin = { pathname: '/add', search: '?game=%E8%88%B9%E5%BB%A0&name=Shipyard', hash: '#rule-1' };
    const link = loginHref(origin);
    expect(loginReturnTo(link.slice(link.indexOf('?')))).toBe(`${origin.pathname}${origin.search}${origin.hash}`);
  });

  test.each(['', 'https://evil.example', '//evil.example', '/\\evil.example', '/a\nb', '/login', '/login/?returnTo=/add', '/a/../login'])('uses the account page for an unsafe or looping destination: %s', value => {
    expect(loginReturnTo(`?${new URLSearchParams({ returnTo: value })}`)).toBe('/account');
  });

  test('uses the account page for a normal login without an originating action', () => {
    expect(loginReturnTo('')).toBe('/account');
  });
});
