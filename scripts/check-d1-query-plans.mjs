// Finds worker SQL whose plan scans a table only because of stored statistics.
// Migrations run PRAGMA optimize while tables are tiny; production keeps those
// statistics as tables grow, so a cheap-looking scan becomes a full read.
// node scripts/check-d1-query-plans.mjs
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMigratedSchema } from './check-d1-trigger-fanout.mjs';

// file|table → why a full read is acceptable there.
export const ACCEPTED_STATISTICS_SCANS = new Map([
  ['worker/data/attributeCatalog.ts|attribute_catalog_snapshot_chunks', 'holds one generation; rebuild deletes the rest'],
  ['worker/data/gameCatalog.ts|game_catalog_snapshot_chunks', 'holds one generation; rebuild deletes the rest'],
  ['worker/data/attributeReplay.ts|attribute_replay_snapshot_chunks', 'holds one generation; rebuild deletes the rest'],
  ['worker/data/attributeReplay.ts|game_external_ids', 'background replay reads every BGG id'],
  ['worker/data/attributeQueries.ts|attribute_import_candidates', 'admin import review lists open candidates'],
]);

const listSources = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return listSources(path);
  return path.endsWith('.ts') && !path.includes('.test.') ? [path] : [];
});

const MAX_VARIANTS = 8;

// Reconstructs the possible texts of a SQL argument: interpolated placeholder
// lists become two placeholders, and string branches of an expression are tried.
const sqlVariants = (node, constants) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isIdentifier(node)) return constants.get(node.text) ?? null;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = sqlVariants(node.left, constants) ?? ['1'];
    const right = sqlVariants(node.right, constants) ?? ['1'];
    return left.flatMap((a) => right.map((b) => a + b)).slice(0, MAX_VARIANTS);
  }
  if (!ts.isTemplateExpression(node)) return null;
  let texts = [node.head.text];
  for (const span of node.templateSpans) {
    const expression = span.expression;
    let options;
    if (/=>\s*'\?'/.test(expression.getText())) options = ['?, ?'];
    else if (ts.isIdentifier(expression) && constants.has(expression.text)) options = constants.get(expression.text);
    else {
      const literals = [];
      const visit = (child) => {
        if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) literals.push(child.text);
        else if (ts.isTemplateExpression(child)) literals.push(...(sqlVariants(child, constants) ?? []));
        else ts.forEachChild(child, visit);
      };
      visit(expression);
      options = literals.length ? [...new Set(literals)] : ['1'];
      if (ts.isConditionalExpression(expression) && options.length === 1) options.push('');
    }
    texts = texts.flatMap((text) => options.slice(0, 3).map((option) => text + option + span.literal.text)).slice(0, MAX_VARIANTS);
  }
  return texts;
};

export const collectWorkerSql = (root = 'worker') => {
  const statements = [];
  const constants = new Map();
  for (const file of listSources(root)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const collectConstants = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const texts = sqlVariants(node.initializer, constants);
        if (texts && /\b(SELECT|FROM)\b/i.test(texts[0])) constants.set(node.name.text, texts);
      }
      ts.forEachChild(node, collectConstants);
    };
    collectConstants(source);
    const collectCalls = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ['statement', 'prepare'].includes(node.expression.name.text) && node.arguments[0]) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        statements.push({ file: relative('.', file).replaceAll('\\', '/'), line, texts: sqlVariants(node.arguments[0], constants) });
      }
      ts.forEachChild(node, collectCalls);
    };
    collectCalls(source);
  }
  return statements;
};

const scannedTables = (db, sql) => {
  let plan;
  try { plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(); } catch { return null; }
  return plan.map((row) => /^SCAN (\w+)/.exec(String(row.detail))?.[1]).filter(Boolean);
};

// Aliases in plans are resolved back to table names from the SQL text.
const tableName = (sql, alias) => {
  const match = new RegExp(`\\b(?:FROM|JOIN)\\s+(\\w+)\\s+(?:AS\\s+)?${alias}\\b`, 'i').exec(sql);
  return match ? match[1] : alias;
};

export const auditStatisticsScans = (statements = collectWorkerSql()) => {
  const withStats = buildMigratedSchema();
  const withoutStats = buildMigratedSchema();
  try {
    withoutStats.exec('DELETE FROM sqlite_stat1');
    withoutStats.exec('ANALYZE sqlite_schema');
    const issues = [];
    let explained = 0;
    for (const statement of statements) {
      let ok = false;
      for (const sql of statement.texts ?? []) {
        const stale = scannedTables(withStats, sql);
        if (!stale) continue;
        ok = true;
        const fresh = new Set(scannedTables(withoutStats, sql) ?? []);
        for (const alias of stale.filter((name) => !fresh.has(name))) {
          const table = tableName(sql, alias);
          const key = `${statement.file}|${table}`;
          if (!ACCEPTED_STATISTICS_SCANS.has(key)) issues.push(`${statement.file}:${statement.line} scans ${table} only under stored statistics`);
        }
      }
      if (ok) explained++;
    }
    return { issues: [...new Set(issues)], explained, total: statements.length };
  } finally {
    withStats.close();
    withoutStats.close();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { issues, explained, total } = auditStatisticsScans();
  console.log(`Query plan check: ${explained}/${total} worker statements explained.`);
  for (const issue of issues) console.error(issue);
  if (issues.length) process.exit(1);
}
