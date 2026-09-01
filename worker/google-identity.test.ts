import { generateKeyPair, SignJWT } from 'jose';
import { describe, expect, test } from 'vitest';
import { googleAudiences, verifyGoogleIdentity } from './auth';

const CLIENT_ID = 'core-flow-test.apps.googleusercontent.com';

const credential = async (overrides: Record<string, unknown> = {}) => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const token = await new SignJWT({
    sub: 'google-user-1',
    email: 'tester@example.com',
    email_verified: true,
    name: '核心流程測試者',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'core-test' })
    .setIssuer('https://accounts.google.com')
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { token, publicKey };
};

describe('Google identity contract', () => {
  test('accepts a verified Google identity for any configured client ID', async () => {
    const { token, publicKey } = await credential();
    const identity = await verifyGoogleIdentity(token, {
      GOOGLE_CLIENT_ID: 'another-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_IDS: ` ${CLIENT_ID},another-client.apps.googleusercontent.com `,
    }, async () => publicKey);

    expect(identity).toEqual(expect.objectContaining({
      sub: 'google-user-1',
      email: 'tester@example.com',
      emailVerified: true,
      name: '核心流程測試者',
    }));
    expect(googleAudiences({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_IDS: CLIENT_ID })).toEqual([CLIENT_ID]);
  });

  test('rejects a token issued for another audience', async () => {
    const { token, publicKey } = await credential();
    await expect(verifyGoogleIdentity(token, { GOOGLE_CLIENT_ID: 'wrong-client.apps.googleusercontent.com' }, async () => publicKey)).rejects.toThrow();
  });

  test('rejects an unverified email', async () => {
    const { token, publicKey } = await credential({ email_verified: false });
    await expect(verifyGoogleIdentity(token, { GOOGLE_CLIENT_ID: CLIENT_ID }, async () => publicKey)).rejects.toThrow('invalid_google_identity');
  });

  test('fails closed when Google login is not configured', async () => {
    const { token, publicKey } = await credential();
    await expect(verifyGoogleIdentity(token, {}, async () => publicKey)).rejects.toThrow('google_auth_not_configured');
  });
});
// @vitest-environment node
