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
