import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '../src/shared/nameNormalization.ts';
import { gameNameRepairs } from './game-name-normalization.mjs';

// Read-only: two full-table SELECTs (games, game_aliases); every check below runs in memory.
export const HEALTH_QUERIES = {
  games: 'SELECT id, slug, display_name, english_name, normalized_name, bgg_id, merged_into_game_id, visibility, entity_kind, published_rule_count FROM games',
  aliases: 'SELECT id, game_id, alias, normalized_alias FROM game_aliases',
};

const summarize = (game) => ({
  id: game.id, slug: game.slug, name: game.display_name, englishName: game.english_name ?? null,
  bggId: game.bgg_id ?? null, kind: game.entity_kind, visibility: game.visibility, publishedRules: game.published_rule_count ?? 0,
});

export const analyzeGameData = (games, aliases) => {
  const active = games.filter((game) => !game.merged_into_game_id);
  const byId = new Map(active.map((game) => [game.id, game]));

  // Public base games without a BGG ID cannot join attribute voting or collection matching.
  const missingBggIds = active
    .filter((game) => game.bgg_id == null && game.visibility === 'public' && game.entity_kind === 'base')
    .sort((a, b) => (b.published_rule_count ?? 0) - (a.published_rule_count ?? 0) || a.display_name.localeCompare(b.display_name))
    .map(summarize);

  const bggOwners = new Map();
  active.filter((game) => game.bgg_id != null).forEach((game) => {
    bggOwners.set(game.bgg_id, [...(bggOwners.get(game.bgg_id) ?? []), game]);
  });
  const duplicateBggIds = [...bggOwners].filter(([, owners]) => owners.length > 1)
    .map(([bggId, owners]) => ({ bggId, games: owners.map(summarize) }));

  // Recompute keys from the visible text so a stale stored key cannot hide a duplicate.
  const nameOwners = new Map();
  const addName = (gameId, text, source) => {
    const key = text ? normalizeName(text) : '';
    if (!key || !byId.has(gameId)) return;
    const owners = nameOwners.get(key) ?? new Map();
    owners.set(gameId, [...(owners.get(gameId) ?? []), `${source}:${text}`]);
    nameOwners.set(key, owners);
  };
  active.forEach((game) => {
    addName(game.id, game.display_name, 'name');
    addName(game.id, game.english_name, 'english');
  });
  aliases.forEach((alias) => addName(alias.game_id, alias.alias, 'alias'));
  const duplicateNameCandidates = [...nameOwners].filter(([, owners]) => owners.size > 1)
    .map(([key, owners]) => ({ key, games: [...owners].map(([gameId, matches]) => ({ ...summarize(byId.get(gameId)), matches })) }));

  return {
    counts: { games: games.length, activeGames: active.length, aliases: aliases.length },
    noncanonicalKeys: gameNameRepairs(games, aliases),
    duplicateBggIds,
    duplicateNameCandidates,
    missingBggIds,
  };
};

// Stored keys and BGG ownership are invariants; the other lists are review queues.
export const hasInvariantFailures = (report) => report.noncanonicalKeys.length > 0 || report.duplicateBggIds.length > 0;

const runQuery = (wrangler, target, sql, persistTo) => {
  const args = target === 'remote'
    ? ['d1', 'execute', 'board-game-rules-prod', '--remote', '--config', 'wrangler.production.jsonc']
    : ['d1', 'execute', 'board-game-rules-local', '--local', '--config', 'wrangler.jsonc', ...(persistTo ? [`--persist-to=${persistTo}`] : [])];
  const output = execFileSync(process.execPath, [wrangler, ...args, '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const [result] = JSON.parse(output);
  return { rows: result.results ?? [], rowsRead: result.meta?.rows_read ?? null, rowsWritten: result.meta?.rows_written ?? null };
};

const printList = (title, items, format) => {
  console.log(`\n## ${title}（${items.length}）`);
  items.forEach((item) => console.log(`- ${format(item)}`));
};

const main = () => {
  const target = process.argv.includes('--remote') ? 'remote' : 'local';
  const persistArg = process.argv.find((arg) => arg.startsWith('--persist-to='));
  const persistTo = persistArg ? path.resolve(persistArg.slice('--persist-to='.length)) : undefined;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  process.chdir(root);

  const games = runQuery(wrangler, target, HEALTH_QUERIES.games, persistTo);
  const aliases = runQuery(wrangler, target, HEALTH_QUERIES.aliases, persistTo);
  const report = {
    target,
    checkedAt: new Date().toISOString(),
    usage: { games: { rowsRead: games.rowsRead, rowsWritten: games.rowsWritten }, aliases: { rowsRead: aliases.rowsRead, rowsWritten: aliases.rowsWritten } },
    ...analyzeGameData(games.rows, aliases.rows),
  };
  const outputDir = path.join(root, '.wrangler', 'game-data-health');
  mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `${target}-${report.checkedAt.replaceAll(':', '-')}.json`);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);

  const label = (game) => `${game.name}${game.englishName ? ` / ${game.englishName}` : ''}（${game.id}，${game.kind}，${game.publishedRules} 條規則）`;
  console.log(`# 遊戲資料健檢（${target}）`);
  console.log(`遊戲 ${report.counts.games}（未合併 ${report.counts.activeGames}），別名 ${report.counts.aliases}`);
  console.log(`D1 讀取：games ${games.rowsRead ?? '?'} 列、aliases ${aliases.rowsRead ?? '?'} 列；寫入 ${(games.rowsWritten ?? 0) + (aliases.rowsWritten ?? 0)} 列`);
  printList('比對鍵與名稱不一致', report.noncanonicalKeys, (row) => `${row.table}:${row.id} ${row.name} → ${row.key}`);
  printList('BGG ID 重複', report.duplicateBggIds, (row) => `${row.bggId}：${row.games.map(label).join('；')}`);
  printList('名稱可能重複', report.duplicateNameCandidates, (row) => `${row.key}：${row.games.map((game) => `${label(game)} [${game.matches.join('、')}]`).join('；')}`);
  printList('公開主遊戲缺少 BGG ID', report.missingBggIds, label);
  console.log(`\n完整報告：${path.relative(root, outputFile)}`);
  if (hasInvariantFailures(report)) process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
