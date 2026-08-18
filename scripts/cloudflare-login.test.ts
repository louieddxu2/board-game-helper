import { describe, expect, it } from 'vitest';
import { extractAuthUrl, WRANGLER_LOGIN_ARGS } from './cloudflare-login.mjs';

describe('Cloudflare login flow', () => {
  it('uses the known-working non-keyring browser flow', () => {
    expect(WRANGLER_LOGIN_ARGS).toEqual([
      'wrangler',
      'login',
      '--no-use-keyring',
      '--browser=false',
    ]);
  });

  it('extracts the current OAuth URL without exposing unrelated output', () => {
    const url = 'https://dash.cloudflare.com/oauth2/auth?response_type=code&state=fresh-state&code_challenge=fresh-challenge';
    expect(extractAuthUrl(`Attempting to login via OAuth...\nVisit this link to authenticate: ${url}\n`)).toBe(url);
  });

  it('removes terminal formatting before extracting the OAuth URL', () => {
    const url = 'https://dash.cloudflare.com/oauth2/auth?response_type=code&state=formatted';
    expect(extractAuthUrl(`\u001b[32m${url}\u001b[0m`)).toBe(url);
  });
});
