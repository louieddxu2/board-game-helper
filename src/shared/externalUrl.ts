export const DIRECT_EXTERNAL_HOSTS = new Set([
  'boardgamegeek.com',
  'www.boardgamegeek.com',
]);

export const parseSafeExternalUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
};

export const isSafeExternalUrl = (value: string): boolean => Boolean(parseSafeExternalUrl(value));

export const isDirectExternalUrl = (value: string): boolean => {
  const url = parseSafeExternalUrl(value);
  return Boolean(url && DIRECT_EXTERNAL_HOSTS.has(url.hostname.toLowerCase()));
};
