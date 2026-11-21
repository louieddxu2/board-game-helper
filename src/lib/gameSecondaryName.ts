const CJK = /[㐀-鿿豈-﫿]/;

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * A second name to show beside a game's title: a Chinese title gets its English name, an English
 * title gets a Chinese alias, and otherwise the first name that differs from the title.
 */
export const secondaryGameName = (displayName: string, englishName?: string | null, aliases: readonly string[] = []) => {
  const candidates = [englishName ?? '', ...aliases]
    .map(name => name.trim())
    .filter((name, index, names) => name && !sameName(name, displayName)
      && names.findIndex(other => sameName(other, name)) === index);
  const titleIsChinese = CJK.test(displayName);
  return candidates.find(name => CJK.test(name) !== titleIsChinese) ?? candidates[0];
};
