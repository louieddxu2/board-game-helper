import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const catalogPath = path.resolve('src/content/zh-TW.json');
const lockPath = path.resolve('scripts/protected-copy.sha256');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const canonicalCopy = JSON.stringify(catalog);
const expected = fs.readFileSync(lockPath, 'utf8').trim().toLowerCase();
const actual = createHash('sha256').update(canonicalCopy, 'utf8').digest('hex');

if (!/^[a-f0-9]{64}$/.test(expected)) {
  console.error('Protected-copy lock is invalid. Do not replace it without explicit author approval.');
  process.exit(1);
}

if (actual !== expected) {
  console.error([
    'Author-owned copy or canonical UI terms changed.',
    'src/content/zh-TW.json is protected and may change only when the author explicitly requests the exact wording change.',
    'Do not update scripts/protected-copy.sha256 merely to bypass this check.',
    `Expected: ${expected}`,
    `Actual:   ${actual}`,
  ].join('\n'));
  process.exit(1);
}

const requiredConsumers = [
  ['src/pages/ContributionsPage.tsx', 'zhTWCopy.author.editorApplication'],
  ['src/pages/PrivacyPage.tsx', 'zhTWCopy.author.privacyOpening'],
];

for (const [relativePath, requiredReference] of requiredConsumers) {
  const source = fs.readFileSync(path.resolve(relativePath), 'utf8');
  if (!source.includes(requiredReference)) {
    console.error(`${relativePath} must render protected copy from ${requiredReference}.`);
    process.exit(1);
  }
}

const walkTsx = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return walkTsx(fullPath);
  return entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [fullPath] : [];
});

for (const filePath of walkTsx(path.resolve('src'))) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const term of Object.values(catalog.terms)) {
    if (source.includes(term)) {
      console.error(`${path.relative(process.cwd(), filePath)} hard-codes canonical term "${term}"; use zh-TW.json instead.`);
      process.exit(1);
    }
  }
}

console.log('Protected author copy and canonical UI terms are unchanged.');
