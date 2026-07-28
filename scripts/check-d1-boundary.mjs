import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('worker');
const allowedFiles = new Set(['worker/env.ts']);
const allowedDirectories = ['worker/data/'];
const forbiddenPatterns = [
  /\bc\.env\.DB\b/,
  /\benv\.DB\b/,
  /\bc\.env\s*\[\s*['"]DB['"]\s*\]/,
  /\benv\s*\[\s*['"]DB['"]\s*\]/,
  /\b(?:const|let|var)\s*\{[^}]*\bDB\b[^}]*\}\s*=/,
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

const apiSource = fs.readFileSync(path.resolve('src/lib/api.ts'), 'utf8');
if (!/game:\s*async\s*\(identifier:\s*string,\s*includePrivate\s*=\s*false\)/.test(apiSource)) {
  violations.push('src/lib/api.ts: api.game must expose only identifier and includePrivate; cache bypass parameters are forbidden');
}
if (/fetchGame\s*=\s*[^\n]*(?:fresh|force)/.test(apiSource)) {
  violations.push('src/lib/api.ts: fetchGame must not accept a fresh/force cache bypass');
}
if (/\b(?:fresh|force)\b/.test(apiSource)) {
  violations.push('src/lib/api.ts: cache reads must not expose fresh/force bypass identifiers; invalidate first, then use the cache-first function');
}

const workerIndexSource = fs.readFileSync(path.resolve('worker/index.ts'), 'utf8');
if (/query\(\s*['"]fresh['"]\s*\)/.test(workerIndexSource)) {
  violations.push('worker/index.ts: URL parameters must not disable response caching');
}

const clientFiles = ['src/pages', 'src/components'];
for (const directory of clientFiles) {
  const scanClient = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { scanClient(fullPath); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(fullPath, 'utf8');
      if (/fetch\s*\(\s*[`'"]\/api\/games\//.test(source)) {
        violations.push(`${path.relative(process.cwd(), fullPath).replaceAll('\\', '/')}: game detail reads must use api.game cache boundary`);
      }
    }
  };
  scanClient(path.resolve(directory));
}

const gamesRouteSource = fs.readFileSync(path.resolve('worker/routes/games.ts'), 'utf8');
const tagsRouteSource = fs.readFileSync(path.resolve('worker/routes/tags.ts'), 'utf8');
const patchGameHandler = gamesRouteSource.split("gamesRoutes.patch('/api/games/:id'")[1]?.split('const mergeSchema')[0] ?? '';
if (/\bFROM\s+rules\b/i.test(patchGameHandler)) {
  violations.push('worker/routes/games.ts: game rename authorization must not scan rules');
}

const publicGameSearchHandler = gamesRouteSource.split("gamesRoutes.get('/api/games/search'")[1]?.split("gamesRoutes.get('/api/game-catalog'")[0] ?? '';
const combinedSearchHandler = tagsRouteSource.split("tagsRoutes.get('/api/search'")[1]?.split("tagsRoutes.get('/api/tags'")[0] ?? '';
if (/\bFROM\s+(?:games|game_aliases)\b/i.test(publicGameSearchHandler + combinedSearchHandler)) {
  violations.push('worker routes: public search handlers must read the one-row game catalog, not games or aliases');
}
if (!apiSource.includes("transportRequest<GameCatalogPayload>('/api/game-catalog'")) {
  violations.push('src/lib/api.ts: public game search must enter through the daily one-row game catalog endpoint');
}
if (/\/api\/(?:games\/search|search)\?q=/.test(apiSource)) {
  violations.push('src/lib/api.ts: per-query server game search is forbidden; filter the daily catalog locally');
}

if (violations.length > 0) {
  console.error('D1/cache boundary check failed:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log('D1/cache boundary check passed: direct D1 access is confined and cache bypasses are forbidden.');
