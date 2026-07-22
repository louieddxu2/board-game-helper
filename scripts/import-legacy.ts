import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readSheet } from 'read-excel-file/node';
import { chooseFlowStage, firstUrl, normalizeLegacyName, parseDeclaredCount, splitLegacyRules, sqlValue, stableLegacyId, type LegacyRecord } from './legacy';

const root = process.cwd();
const sourcePath = path.resolve(root, '玩錯的桌遊規則紀錄.xlsx');
const outputDir = path.resolve(root, 'imports/generated');
const outputPath = path.join(outputDir, 'legacy-import.sql');
const apply = process.argv.includes('--apply');
const remote = process.argv.includes('--remote');

if (remote && !process.argv.includes('--confirm-remote')) {
  throw new Error('Remote import requires --confirm-remote');
}

const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const worksheet = await readSheet(sourceBytes);
const [headerRow, ...dataRows] = worksheet;
if (!headerRow) throw new Error('Workbook has no worksheet rows');
const headers = headerRow.map((value) => String(value ?? '').trim());
const rawRows = dataRows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));

const text = (value: unknown) => String(value ?? '').trim();
const records: LegacyRecord[] = rawRows.map((row, index) => ({
  rowNumber: index + 2,
  timestamp: row['時間戳記'] instanceof Date ? row['時間戳記'].toISOString() : text(row['時間戳記']),
  gameName: text(row['玩錯的桌遊名稱']),
  ruleText: text(row['玩錯的規則與正確規則詳述']),
  category: text(row['玩錯的規則類型']),
  declaredCount: parseDeclaredCount(row['玩錯的規則數量']),
  sourceLabel: text(row['正確規則的來源']),
  sourceUrl: text(row['正確規則網頁或圖片連結（若有的話）']),
})).filter((row) => row.gameName && row.ruleText);

const batchId = stableLegacyId('import', sourceHash);
const timestamp = Date.now();
const lines: string[] = [
  'PRAGMA foreign_keys = ON;',
  'BEGIN TRANSACTION;',
  `INSERT OR IGNORE INTO import_batches (id, source_filename, source_hash, row_count, status, created_at, imported_at) VALUES (${sqlValue(batchId)}, ${sqlValue(path.basename(sourcePath))}, ${sqlValue(sourceHash)}, ${records.length}, 'imported', ${timestamp}, ${timestamp});`,
];

const gameIds = new Map<string, string>();
for (const record of records) {
  const normalized = normalizeLegacyName(record.gameName);
  if (gameIds.has(normalized)) continue;
  const gameId = stableLegacyId('game', normalized);
  gameIds.set(normalized, gameId);
  const slugBase = record.gameName.normalize('NFKD').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54) || 'game';
  const slug = `${slugBase}-${gameId.slice(-6)}`;
  lines.push(`INSERT OR IGNORE INTO games (id, slug, display_name, normalized_name, created_at, updated_at) VALUES (${sqlValue(gameId)}, ${sqlValue(slug)}, ${sqlValue(record.gameName)}, ${sqlValue(normalized)}, ${timestamp}, ${timestamp});`);
  lines.push(`INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at) VALUES (${sqlValue(stableLegacyId('alias', `${gameId}:${normalized}`))}, ${sqlValue(gameId)}, ${sqlValue(record.gameName)}, ${sqlValue(normalized)}, 'legacy', ${timestamp});`);
}

let publishedRules = 0;
let reviewRows = 0;
for (const record of records) {
  const rowKey = `${sourceHash}:${record.rowNumber}`;
  const rowId = stableLegacyId('legacy', rowKey);
  const gameId = gameIds.get(normalizeLegacyName(record.gameName))!;
  const proposed = splitLegacyRules(record.ruleText);
  const countsMatch = !record.declaredCount || proposed.length === record.declaredCount;
  const status = countsMatch ? 'imported' : 'pending';
  if (!countsMatch) reviewRows += 1;
  lines.push(`INSERT OR IGNORE INTO legacy_import_rows (id, batch_id, source_row_number, raw_game_name, raw_rule_text, raw_category, raw_source_label, raw_source_url, raw_timestamp, declared_rule_count, proposed_rules_json, matched_game_id, status, created_at) VALUES (${sqlValue(rowId)}, ${sqlValue(batchId)}, ${record.rowNumber}, ${sqlValue(record.gameName)}, ${sqlValue(record.ruleText)}, ${sqlValue(record.category)}, ${sqlValue(record.sourceLabel)}, ${sqlValue(record.sourceUrl)}, ${sqlValue(record.timestamp)}, ${record.declaredCount ?? 'NULL'}, ${sqlValue(JSON.stringify(proposed))}, ${sqlValue(gameId)}, ${sqlValue(status)}, ${timestamp});`);
  if (!countsMatch) continue;
  const submissionId = stableLegacyId('sub', rowKey);
  lines.push(`INSERT OR IGNORE INTO submissions (id, game_id, played_on, source_label, source_url, legacy_import_row_id, created_at) VALUES (${sqlValue(submissionId)}, ${sqlValue(gameId)}, ${sqlValue(record.timestamp.slice(0, 10))}, ${sqlValue(record.sourceLabel)}, ${sqlValue(firstUrl(record.sourceUrl))}, ${sqlValue(rowId)}, ${timestamp});`);
  proposed.forEach((statement, index) => {
    const ruleId = stableLegacyId('rule', `${rowKey}:${index}`);
    lines.push(`INSERT OR IGNORE INTO rules (id, submission_id, game_id, statement, flow_stage, status, created_at, updated_at) VALUES (${sqlValue(ruleId)}, ${sqlValue(submissionId)}, ${sqlValue(gameId)}, ${sqlValue(statement)}, ${sqlValue(chooseFlowStage(record.category))}, 'published', ${timestamp + index}, ${timestamp + index});`);
    publishedRules += 1;
  });
}

lines.push(`
WITH ranked_games AS (
  SELECT game_id, COUNT(*) rule_count, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, game_id) rank
  FROM rules WHERE status = 'published' GROUP BY game_id
), first_rules AS (
  SELECT r.id, rg.rank, ROW_NUMBER() OVER (PARTITION BY r.game_id ORDER BY r.created_at, r.id) row_number
  FROM rules r JOIN ranked_games rg ON rg.game_id = r.game_id WHERE rg.rank <= 6
)
UPDATE rules SET is_featured = 1,
  featured_order = (SELECT rank FROM first_rules WHERE first_rules.id = rules.id)
WHERE id IN (SELECT id FROM first_rules WHERE row_number = 1);
`);
lines.push('COMMIT;');
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, lines.join('\n'), 'utf8');

console.log(JSON.stringify({
  source: sourcePath, rows: records.length, games: gameIds.size,
  publishedRules, reviewRows, output: outputPath,
}, null, 2));

if (apply) {
  const wranglerCli = path.resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  const args = [wranglerCli, 'd1', 'execute', remote ? 'board-game-rules-prod' : 'board-game-rules-local', remote ? '--remote' : '--local', `--file=${outputPath}`];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, XDG_CONFIG_HOME: path.resolve(root, '.wrangler/xdg') },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
