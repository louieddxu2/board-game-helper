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
if (!/game:\s*async\s*\(identifier:\s*string,\s*includePrivate\s*=\s*false,\s*onUpdated\?:/.test(apiSource)) {
  violations.push('src/lib/api.ts: api.game may expose only identity, privacy scope, and an update callback; cache bypass parameters are forbidden');
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
const authSource = fs.readFileSync(path.resolve('worker/auth.ts'), 'utf8');
const adminRouteSource = fs.readFileSync(path.resolve('worker/routes/admin.ts'), 'utf8');
if (/isPublicCacheableRequest[\s\S]*?export\/public/.test(workerIndexSource)) {
  violations.push('worker/index.ts: full dataset export must never be a public cacheable request');
}
if (/isPublicReadRequest[\s\S]*?export\/public/.test(authSource)) {
  violations.push('worker/auth.ts: full dataset export must remain outside the public authentication fast path');
}
if (!/get\('\/api\/export\/public',\s*requireRole\('admin'\)/.test(adminRouteSource)) {
  violations.push('worker/routes/admin.ts: full dataset export must remain administrator-only');
}

const productionConfigSource = fs.readFileSync(path.resolve('wrangler.production.jsonc'), 'utf8');
if (!productionConfigSource.includes('"crons": ["0 16 * * *"]')) {
  violations.push('wrangler.production.jsonc: anonymous view cleanup requires the single daily Taipei-midnight trigger');
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
const rulesRouteSource = fs.readFileSync(path.resolve('worker/routes/rules.ts'), 'utf8');
const importanceDataSource = fs.readFileSync(path.resolve('worker/data/ruleImportance.ts'), 'utf8');
const importanceMigrationSource = fs.readFileSync(path.resolve('migrations/0030_rule_importance_votes.sql'), 'utf8');
const accountDeletionSource = fs.readFileSync(path.resolve('worker/data/accountDeletion.ts'), 'utf8');
const accountDeletionMigrationSource = fs.readFileSync(path.resolve('migrations/0031_account_deletion.sql'), 'utf8');
const editorCatalogRoutePath = path.resolve('worker/routes/catalog.ts');
const editorCatalogRouteSource = fs.existsSync(editorCatalogRoutePath) ? fs.readFileSync(editorCatalogRoutePath, 'utf8') : '';
const patchGameHandler = gamesRouteSource.split("gamesRoutes.patch('/api/games/:id'")[1]?.split('const mergeSchema')[0] ?? '';
if (/\bFROM\s+rules\b/i.test(patchGameHandler)) {
  violations.push('worker/routes/games.ts: game rename authorization must not scan rules');
}
const publicGameDetailHandler = gamesRouteSource.split("gamesRoutes.get('/api/games/:identifier'")[1]?.split("gamesRoutes.patch('/api/games/:id'")[0] ?? '';
if (/rule_importance_votes|COUNT\s*\(/i.test(publicGameDetailHandler)) {
  violations.push('worker/routes/games.ts: public game detail must carry the pre-aggregated count and never scan/count vote rows');
}
if (!/WHERE\s+user_id\s*=\s*\?\s+AND\s+game_id\s*=\s*\?/i.test(importanceDataSource)) {
  violations.push('worker/data/ruleImportance.ts: personal vote reads must use the user_id + game_id composite boundary');
}
if (/COUNT\s*\(|JOIN\s+rule_importance_votes/i.test(importanceDataSource)) {
  violations.push('worker/data/ruleImportance.ts: vote operations must not count or join vote history');
}
if (!/PRIMARY KEY\s*\(user_id,\s*rule_id\)/i.test(importanceMigrationSource)
  || !/idx_rule_importance_votes_user_game[\s\S]*\(user_id,\s*game_id,\s*rule_id\)/i.test(importanceMigrationSource)) {
  violations.push('0030 migration: votes require unique user-rule identity and indexed user-game reads');
}
if (!/AFTER INSERT ON rule_importance_votes[\s\S]*importance_count\s*=\s*importance_count\s*\+\s*1/i.test(importanceMigrationSource)
  || !/AFTER DELETE ON rule_importance_votes[\s\S]*importance_count\s*=\s*MAX\(0,\s*importance_count\s*-\s*1\)/i.test(importanceMigrationSource)) {
  violations.push('0030 migration: aggregate vote counts must be maintained atomically by insert/delete triggers');
}
if (/importance[\s\S]{0,300}updated_at|updated_at[\s\S]{0,300}importance/i.test(importanceDataSource)) {
  violations.push('worker/data/ruleImportance.ts: voting must not churn rule content versions');
}
if (!rulesRouteSource.includes("get('/api/games/:gameId/rule-importance', requireUser")
  || !rulesRouteSource.includes("put('/api/rules/:id/importance', requireUser")) {
  violations.push('worker/routes/rules.ts: both personal vote reads and writes must require authentication');
}
if (!/rule-importance:\$\{user\.id\}/.test(rulesRouteSource)) {
  violations.push('worker/routes/rules.ts: vote writes require an account-scoped limiter in addition to the IP limiter');
}
if (!/DELETE FROM rules[\s\S]*created_by = \?[\s\S]*NOT EXISTS[\s\S]*rr\.rule_id = rules\.id AND rr\.edited_by <> \?/i.test(accountDeletionSource)) {
  violations.push('worker/data/accountDeletion.ts: optional rule deletion must recheck creator and all revision authors atomically');
}
if (!/UPDATE rules\s+SET created_by = \? WHERE created_by = \?/i.test(accountDeletionSource)
  || !/DELETE FROM users WHERE id = \?/i.test(accountDeletionSource)) {
  violations.push('worker/data/accountDeletion.ts: retained rules must be anonymized before the original account row is removed');
}
const requiredDeletionIndexes = [
  'idx_rule_revisions_edited_by', 'idx_tags_created_by', 'idx_rule_tags_created_by',
  'idx_games_created_by', 'idx_submissions_author', 'idx_review_batches_created_by',
  'idx_review_proposals_created_by', 'idx_user_roles_active_role', 'idx_rules_submission_id',
  'idx_sessions_user_id',
];
for (const index of requiredDeletionIndexes) {
  if (!accountDeletionMigrationSource.includes(index)) {
    violations.push(`0031 migration: account deletion requires ${index} to avoid unrelated-row scans`);
  }
}
if (!/users_prevent_last_admin_delete[\s\S]*RAISE\(ABORT, 'last_admin_account'\)/i.test(accountDeletionMigrationSource)) {
  violations.push('0031 migration: the database must prevent deletion of the last active administrator');
}
if (!apiSource.includes('getCachedRuleImportance(userId, gameId)')) {
  violations.push('src/lib/api.ts: personal vote state must pass through the local cache before network access');
}

const publicGameSearchHandler = gamesRouteSource.split("gamesRoutes.get('/api/games/search'")[1]?.split("gamesRoutes.get('/api/game-catalog'")[0] ?? '';
const combinedSearchHandler = tagsRouteSource.split("tagsRoutes.get('/api/search'")[1]?.split("tagsRoutes.get('/api/tags'")[0] ?? '';
if (/\bFROM\s+(?:games|game_aliases)\b/i.test(publicGameSearchHandler + combinedSearchHandler)) {
  violations.push('worker routes: public search handlers must read the catalog snapshot, not games or aliases');
}
if (!apiSource.includes("transportRequest<GameCatalogPayload>('/api/game-catalog'")) {
  violations.push('src/lib/api.ts: public game search must bootstrap through the weekly game catalog snapshot endpoint');
}
if (/\/api\/(?:games\/search|search)\?q=/.test(apiSource)) {
  violations.push('src/lib/api.ts: per-query server game search is forbidden; filter the synchronized catalog locally');
}
if (/\/api\/editor\/catalog\/games/.test(apiSource) || /\bFROM\s+games\b/i.test(editorCatalogRouteSource)) {
  violations.push('editor catalog: must reuse the versioned local game catalog instead of reading the games table separately');
}
if (!apiSource.includes('/api/game-catalog/changes?after=')) {
  violations.push('src/lib/api.ts: cached catalogs must synchronize through the version-indexed changes endpoint');
}
if (!apiSource.includes('/api/tags/changes?after=')) {
  violations.push('src/lib/api.ts: public tags must synchronize through the version-indexed changes endpoint');
}
const publicTagHandlers = tagsRouteSource.split("tagsRoutes.get('/api/tags'")[1]?.split('const tagAdminSchema')[0] ?? '';
if (/GROUP_CONCAT|JOIN\s+tag_aliases/i.test(publicTagHandlers)) {
  violations.push('worker/routes/tags.ts: public tag reads must use precomputed version entries without alias joins or grouping');
}
const sharedRouteSource = fs.readFileSync(path.resolve('worker/routes/shared.ts'), 'utf8');
const tagWriteHelper = sharedRouteSource.split('export const tagWriteStatements')[1]?.split('export interface GameRow')[0] ?? '';
if (/JOIN\s+tag_aliases|normalized_alias/i.test(tagWriteHelper)) {
  violations.push('worker/routes/shared.ts: rule tag writes must use submitted IDs or indexed canonical names; alias-table lookup is forbidden');
}
if (!/status\s*=\s*'merged'[\s\S]*merged_into_tag_id/.test(tagWriteHelper)) {
  violations.push('worker/routes/shared.ts: canonical names of merged tags must resolve to their active target');
}
const accountRouteSource = fs.readFileSync(path.resolve('worker/routes/auth.ts'), 'utf8');
const accountHandler = accountRouteSource.split("authRoutes.get('/api/account'")[1]?.split("authRoutes.get('/api/account/created-rules'")[0] ?? '';
if (!/SELECT\s+COUNT\(\*\)\s+total[\s\S]*FROM\s+rules/i.test(accountHandler)
  || /JOIN\s+|FROM\s+rule_revisions\b/i.test(accountHandler)) {
  violations.push('worker/routes/auth.ts: the base account response may read only the created-rule count');
}
const createdRulesHandler = accountRouteSource.split("authRoutes.get('/api/account/created-rules'")[1]?.split("authRoutes.get('/api/account/modified-rules'")[0] ?? '';
if (!/canEdit\s*\?\s*''\s*:\s*" AND r\.review_status = 'reviewed'"/.test(createdRulesHandler)) {
  violations.push('worker/routes/auth.ts: ordinary account history must remain limited to reviewed rules');
}
if (!/LIMIT\s+20\b/.test(createdRulesHandler)) {
  violations.push('worker/routes/auth.ts: created-rule history must remain limited to the latest 20 rows');
}
if (!/get\('\/api\/account\/modified-rules',\s*requireRole\('editor'\)/.test(accountRouteSource)) {
  violations.push('worker/routes/auth.ts: account revision history must remain editor-only');
}

if (violations.length > 0) {
  console.error('D1/cache boundary check failed:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log('D1/cache boundary check passed: direct D1 access is confined and cache bypasses are forbidden.');
