
export const now = () => Date.now();
export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

export const normalizeText = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-Hant')
  .replace(/[\s\p{P}\p{S}]+/gu, '');

export const cleanAliases = (aliases: string[], displayName: string, englishName?: string): string[] => {
  const canonicalNames = new Set([displayName, englishName]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeText));
  const unique = new Map<string, string>();
  for (const alias of aliases) {
    const trimmed = alias.trim();
    const normalized = normalizeText(trimmed);
    if (!normalized || canonicalNames.has(normalized) || unique.has(normalized)) continue;
    unique.set(normalized, trimmed);
  }
  return [...unique.values()];
};

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const hashEmail = async (email: string, secret: string | undefined): Promise<string> => {
  if (!secret || secret.length < 32) throw new Error('email_hash_secret_not_configured');
  const normalized = normalizeEmail(email);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(normalized));
  return `v1:${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const base64UrlEncode = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const base64UrlDecode = (value: string): string | null => {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return null;
  }
};

const hmacHex = async (value: string, secret: string | undefined, usage: 'sign' | 'verify'): Promise<CryptoKey> => {
  if (!secret || secret.length < 32) throw new Error('attribute_question_secret_not_configured');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
};

export interface AttributeQuestionTokenPayload {
  sessionId: string;
  attributeId: string;
  subjectAId: string;
  subjectBId: string;
}

export const signAttributeQuestionToken = async (payload: AttributeQuestionTokenPayload, secret: string | undefined): Promise<string> => {
  const body = base64UrlEncode(JSON.stringify({ v: 1, ...payload }));
  const key = await hmacHex(body, secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${body}.${hex}`;
};

export const verifyAttributeQuestionToken = async (
  token: string,
  expected: AttributeQuestionTokenPayload,
  secret: string | undefined,
): Promise<boolean> => {
  const [body, signatureHex] = token.split('.');
  if (!body || !signatureHex || !/^[0-9a-f]{64}$/u.test(signatureHex)) return false;
  const decoded = base64UrlDecode(body);
  if (!decoded) return false;
  try {
    const parsed = JSON.parse(decoded) as Partial<AttributeQuestionTokenPayload> & { v?: number };
    if (parsed.v !== 1 || parsed.sessionId !== expected.sessionId || parsed.attributeId !== expected.attributeId
      || parsed.subjectAId !== expected.subjectAId || parsed.subjectBId !== expected.subjectBId) return false;
    const signature = Uint8Array.from(signatureHex.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
    const key = await hmacHex(body, secret, 'verify');
    return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(body));
  } catch {
    return false;
  }
};

// Transitional lookup only. New writes must always use hashEmail/HMAC.
export const legacyHashEmail = (email: string): Promise<string> =>
  sha256Hex(`${normalizeEmail(email)}:board_game_helper_salt`);

export const maskEmail = (email: string): string => {
  const normalized = normalizeEmail(email);
  const parts = normalized.split('@');
  if (parts.length !== 2) return '***';
  const [user, domain] = parts;
  if (user.length <= 2) {
    return `${user[0] ?? ''}*@${domain}`;
  }
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
};

const hanCharacter = /^\p{Script=Han}$/u;
const latinCharacter = /^[A-Za-z]$/;

export const normalizeNickname = (value: string): string => normalizeText(value);

export const isValidNickname = (value: string): boolean => {
  const nickname = value.normalize('NFKC').trim();
  if (!nickname) return false;
  let weight = 0;
  for (const character of Array.from(nickname)) {
    if (hanCharacter.test(character)) weight += 2;
    else if (latinCharacter.test(character)) weight += 1;
    else return false;
  }
  return weight <= 12;
};

export const slugify = (value: string): string => {
  const ascii = value.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return ascii || `game-${crypto.randomUUID().slice(0, 8)}`;
};

export const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const cleanOptional = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
};

export const trustedOrigins = (env: { APP_ORIGIN?: string; TRUSTED_APP_ORIGINS?: string }, requestUrl?: string): Set<string> => {
  const values = [
    requestUrl ? new URL(requestUrl).origin : undefined,
    env.APP_ORIGIN,
    ...(env.TRUSTED_APP_ORIGINS ?? '').split(','),
  ];
  return new Set(values.map((value) => value?.trim().replace(/\/$/, '')).filter((value): value is string => Boolean(value)));
};

export const assertMutationOrigin = (c: { req: { header(name: string): string | undefined; url: string }; env: { APP_ORIGIN?: string; TRUSTED_APP_ORIGINS?: string } }): boolean => {
  const origin = c.req.header('origin');
  if (!origin) return true;
  return trustedOrigins(c.env, c.req.url).has(origin.replace(/\/$/, ''));
};

export const apiError = (code: string, status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 = 400) => ({
  error: code,
  status,
});
