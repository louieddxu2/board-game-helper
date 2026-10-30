/** Canonical stored lookup key; visible names keep their original formatting. */
export const normalizeName = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-Hant')
  .replace(/[\s\p{P}\p{S}]+/gu, '');
