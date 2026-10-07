import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maxLines = 600;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.css', '.scss', '.html']);
// Data, historical migrations, dependency locks and generated artifacts retain their formats.
const sourceDirectories = ['src', 'worker', 'scripts', 'integration', 'tests', 'public'];
const violations = [];
let checked = 0;
let largest = 0;

const checkFile = (path) => {
  if (!sourceExtensions.has(extname(path))) return;
  const source = readFileSync(path, 'utf8');
  const lines = source === '' ? 0 : source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
  checked += 1;
  largest = Math.max(largest, lines);
  if (lines > maxLines) violations.push({ file: relative(root, path).replaceAll('\\', '/'), lines });
};

const checkDirectory = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) checkDirectory(child);
    else if (entry.isFile()) checkFile(child);
  }
};

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile()) checkFile(join(root, entry.name));
  else if (entry.isDirectory() && sourceDirectories.includes(entry.name)) checkDirectory(join(root, entry.name));
}

if (violations.length) {
  violations.sort((a, b) => b.lines - a.lines);
  console.error(`Source files must stay within ${maxLines} lines:\n${violations.map(({ file, lines }) => `  ${file}: ${lines}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`File size check passed: ${checked} files, largest ${largest} lines (limit ${maxLines}).`);
}
