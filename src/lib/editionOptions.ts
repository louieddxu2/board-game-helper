const editionKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();

export const collectEditionOptions = (rules: Array<{ editionNote?: string }>): string[] => {
  const options = new Map<string, { name: string; count: number }>();
  for (const rule of rules) {
    const name = rule.editionNote?.normalize('NFKC').trim();
    if (!name) continue;
    const key = editionKey(name);
    const existing = options.get(key);
    if (existing) existing.count += 1;
    else options.set(key, { name, count: 1 });
  }
  return [...options.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hant'))
    .map(({ name }) => name);
};

export const mergeEditionOptions = (...groups: string[][]): string[] => {
  const merged = new Map<string, string>();
  for (const name of groups.flat()) {
    const cleaned = name.normalize('NFKC').trim();
    if (cleaned && !merged.has(editionKey(cleaned))) merged.set(editionKey(cleaned), cleaned);
  }
  return [...merged.values()];
};

export const findEditionOption = (options: string[], value: string) => {
  const key = editionKey(value);
  return options.find((option) => editionKey(option) === key);
};
