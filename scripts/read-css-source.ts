import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
/** Expand local stylesheet imports in cascade order for source and browser tests. */
export const readCssSource = (entry: string, ancestors = new Set<string>()): string => {
  const filename = resolve(entry);
  if (ancestors.has(filename)) throw new Error(`Circular CSS import: ${filename}`);
  const next = new Set(ancestors).add(filename);
  return readFileSync(filename, 'utf8').replace(
    /@import\s+['"]([^'"]+)['"]\s*;\r?\n?/g,
    (statement, imported: string) => imported.startsWith('.')
      ? readCssSource(resolve(dirname(filename), imported), next)
      : statement,
  );
};
