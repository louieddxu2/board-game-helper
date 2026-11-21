// Release gate: measures the D1 rows each pending migration reads and writes, and refuses to
// apply migrations that exceed their budget. Never accesses production.
//
// The migrations before the first pending one are applied to an isolated local D1, which then
// holds every game, alias and attribute those migrations import. Each pending migration is run
// there statement by statement, and D1's own rows_read / rows_written are summed. Production holds
// more rows (accounts, rules, votes), so this undercounts linear work; it still exposes work that
// grows with the square of a table, such as a correlated subquery over an unindexed table.
//
// A migration that must rewrite many rows declares its expected cost on a line of its own:
//   -- d1-row-budget: reads=<n> writes=<n> reason=<why this many rows>
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// The Miniflare that ships with Wrangler, as the request cost check uses; found through normal
// package resolution so a checkout without its own node_modules uses its parent's.
const loadMiniflare = async () => {
  const wranglerRoot = dirname(createRequire(import.meta.url).resolve('wrangler/package.json'));
  return import(pathToFileURL(join(wranglerRoot, 'node_modules', 'miniflare', 'dist', 'src', 'index.js')).href);
};

export const DEFAULT_MIGRATION_ROW_BUDGET = Object.freeze({ reads: 20_000, writes: 2_000 });

// Blank out strings, quoted identifiers and comments without moving any other character.
const maskSql = (sql) => sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\//gu, (text) => text.replace(/[^\r\n]/gu, ' '));

/** Splits a migration into the statements D1 runs, keeping trigger bodies and CASE expressions whole. */
export const splitSqlStatements = (sql) => {
  const masked = maskSql(sql);
  const statements = [];
  let start = 0;
  let depth = 0;
  const push = (end) => {
    if (masked.slice(start, end).trim()) statements.push(sql.slice(start, end).trim());
    start = end;
  };
  for (const match of masked.matchAll(/\b(BEGIN|CASE|END)\b|;/giu)) {
    const word = match[1]?.toUpperCase();
    // BEGIN opens a body only inside CREATE TRIGGER; elsewhere it would start a transaction.
    if (word === 'BEGIN') {
      if (/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/iu.test(masked.slice(start, match.index))) depth += 1;
    } else if (word === 'CASE') depth += 1;
    else if (word === 'END') depth = Math.max(0, depth - 1);
    else if (depth === 0) push(match.index + 1);
  }
  push(sql.length);
  return statements;
};

/** The budget a migration declares for itself, or the default. */
export const migrationRowBudget = (sql) => {
  const declared = sql.match(/^--\s*d1-row-budget:\s*reads=(\d+)\s+writes=(\d+)\s+reason=(\S.*)$/mu);
  return declared
    ? { reads: Number(declared[1]), writes: Number(declared[2]), reason: declared[3].trim() }
    : { ...DEFAULT_MIGRATION_ROW_BUDGET };
};

export const rowBudgetViolations = (measurements) => measurements.flatMap(({ name, reads, writes, budget }) => (
  reads > budget.reads || writes > budget.writes
    ? [`${name}: read ${reads} rows (budget ${budget.reads}) and wrote ${writes} rows (budget ${budget.writes})`]
    : []
));

const migrationFiles = (directory) => readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();

/** Runs every migration from the first pending one on an isolated local D1 and reports their row counts. */
export const measureMigrationRows = async (pending, { directory = 'migrations' } = {}) => {
  const files = migrationFiles(directory);
  const pendingSet = new Set(pending);
  const firstPending = files.findIndex((name) => pendingSet.has(name));
  if (firstPending < 0) return [];
  const { Miniflare, convertV4MiniflareOptions } = await loadMiniflare();
  mkdirSync('.wrangler', { recursive: true });
  const scratch = mkdtempSync(resolve('.wrangler/migration-row-budget-'));
  const options = () => ({
    ...convertV4MiniflareOptions({
      name: 'migration-row-budget', modules: true, script: 'export default {}',
      compatibilityDate: '2026-07-22', cf: false, d1Databases: { DB: 'migration-row-budget' },
    }),
    resourcePersistencePath: scratch,
    isolatedResourcePersistencePath: join(scratch, 'isolated'),
    unsafeDevRegistryPath: join(scratch, 'registry'),
    unsafeEnableSharedStorage: true,
  });
  let mf = new Miniflare(options());
  try {
    await (await mf.getD1Database('DB')).prepare('CREATE TABLE migration_row_budget_marker (id INTEGER)').run();
    await mf.dispose();
    mf = undefined;
    // Earlier migrations only set the stage; apply them directly to the database file.
    const objectDirectory = join(scratch, 'd1', 'miniflare-D1DatabaseObject');
    const file = readdirSync(objectDirectory).find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
    const sqlite = new DatabaseSync(join(objectDirectory, file));
    try {
      sqlite.exec('DROP TABLE migration_row_budget_marker');
      for (const name of files.slice(0, firstPending)) sqlite.exec(readFileSync(join(directory, name), 'utf8'));
    } finally { sqlite.close(); }

    mf = new Miniflare(options());
    const db = await mf.getD1Database('DB');
    const measurements = [];
    for (const name of files.slice(firstPending)) {
      const sql = readFileSync(join(directory, name), 'utf8');
      let reads = 0;
      let writes = 0;
      for (const statement of splitSqlStatements(sql)) {
        const { meta } = await db.prepare(statement).run();
        reads += Number(meta?.rows_read ?? 0);
        writes += Number(meta?.rows_written ?? 0);
      }
      if (pendingSet.has(name)) measurements.push({ name, reads, writes, budget: migrationRowBudget(sql) });
    }
    return measurements;
  } finally {
    await mf?.dispose();
    rmSync(scratch, { recursive: true, force: true });
  }
};

/** Throws when a pending migration reads or writes more D1 rows than its budget allows. */
export const checkMigrationRowBudget = async (pending, options) => {
  if (!pending.length) return [];
  const measurements = await measureMigrationRows(pending, options);
  for (const { name, reads, writes, budget } of measurements) {
    console.log(`   ${name}: ${reads} rows read / ${writes} rows written (budget ${budget.reads} / ${budget.writes})`);
  }
  const violations = rowBudgetViolations(measurements);
  if (violations.length) {
    throw new Error([
      'D1 row budget exceeded on the migrations imported data:',
      ...violations.map((violation) => `  - ${violation}`),
      'Rewrite the migration to read and write fewer rows, or declare its cost on a line of its own:',
      '  -- d1-row-budget: reads=<n> writes=<n> reason=<why this many rows>',
    ].join('\n'));
  }
  return measurements;
};

// node scripts/check-migration-row-budget.mjs <migration.sql> [...]: measure named migrations.
if (import.meta.url === new URL(`file:///${resolve(process.argv[1] ?? '').replaceAll('\\', '/')}`).href) {
  const names = process.argv.slice(2);
  try {
    await checkMigrationRowBudget(names);
    console.log('✅ Migration row budget passed.');
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
