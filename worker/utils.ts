
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

export const hashEmail = async (email: string, salt: string = 'board_game_helper_salt'): Promise<string> => {
  const normalized = normalizeEmail(email);
  return sha256Hex(`${normalized}:${salt}`);
};

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
