
export const now = () => Date.now();
export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

export const normalizeText = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-Hant')
  .replace(/[\s\p{P}\p{S}]+/gu, '');

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

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

export const assertMutationOrigin = (c: { req: { header(name: string): string | undefined; url: string }; env: { APP_ORIGIN?: string } }): boolean => {
  const origin = c.req.header('origin');
  if (!origin) return true;
  const requestOrigin = new URL(c.req.url).origin;
  const configured = c.env.APP_ORIGIN?.replace(/\/$/, '');
  return origin === requestOrigin || Boolean(configured && origin === configured);
};

export const apiError = (code: string, status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 = 400) => ({
  error: code,
  status,
});
