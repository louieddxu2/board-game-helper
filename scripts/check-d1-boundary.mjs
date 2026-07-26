import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('worker');
const allowedFiles = new Set(['worker/env.ts']);
const allowedDirectories = ['worker/data/'];
const forbiddenPatterns = [
  /\bc\.env\.DB\b/,
  /\benv\.DB\b/,
  /\.DB\s*\.\s*(prepare|batch)\s*\(/,
  /\bD1Database\b/,
  /\bD1PreparedStatement\b/,
  /\b(?:db|database)\s*\.\s*(prepare|batch)\s*\(/,
];
const violations = [];

const isAllowed = (relativePath) => allowedFiles.has(relativePath)
  || allowedDirectories.some((directory) => relativePath.startsWith(directory));

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const relativePath = path.relative(process.cwd(), fullPath).replaceAll('\\', '/');
    if (isAllowed(relativePath)) continue;
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenPatterns.some((pattern) => pattern.test(line))) {
        violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      }
    });
  }
};

walk(root);

if (violations.length > 0) {
  console.error('Direct D1 access is forbidden outside worker/data:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log('D1 boundary check passed: direct D1 access is confined to worker/data.');
