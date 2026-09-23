import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const migrationNames = () => readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`;
const maskCommentsAndStrings = (sql) => sql.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//gu, ' ');
const deleteTargets = (sql) => [...maskCommentsAndStrings(sql).matchAll(/\bDELETE\s+FROM\s+["`\[]?([a-z_][a-z_0-9]*)/giu)]
  .map((match) => match[1].toLowerCase());

export const buildMigratedSchema = (throughName) => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of migrationNames()) {
      db.exec(readFileSync(`migrations/${name}`, 'utf8'));
      if (name === throughName) break;
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

const missingForeignKeyIndexes = (db, parentTable) => {
  const issues = [];
  for (const { name: childTable } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    const keys = db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(childTable)})`).all();
    const groups = new Map();
    for (const key of keys) {
      if (String(key.table).toLowerCase() !== parentTable) continue;
      const group = groups.get(key.id) ?? [];
      group.push(key);
      groups.set(key.id, group);
    }
    if (!groups.size) continue;
    const indexes = db.prepare(`PRAGMA index_list(${quoteIdentifier(childTable)})`).all()
      .map(({ name }) => db.prepare(`PRAGMA index_info(${quoteIdentifier(name)})`).all()
        .sort((left, right) => left.seqno - right.seqno).map(({ name: column }) => column));
    for (const group of groups.values()) {
      const columns = group.sort((left, right) => left.seq - right.seq).map(({ from }) => from);
      if (!indexes.some((index) => columns.every((column, position) => index[position] === column))) {
        issues.push(`${childTable}(${columns.join(', ')})`);
      }
    }
  }
  return issues;
};

const unsafeDeletes = (db, sql, origin) => {
  const violations = [];
  for (const table of new Set(deleteTargets(sql))) {
    const children = missingForeignKeyIndexes(db, table);
    if (children.length) violations.push(`${origin}: DELETE FROM ${table} would scan unindexed foreign keys: ${children.join(', ')}`);
  }
  return violations;
};

// Raw vote/history tables grow without a fixed bound. No row-level trigger may
// query them, even with an index; history processing belongs in an explicit job.
const historyTables = [
  'attribute_vote_responses', 'attribute_comparisons', 'attribute_ratings',
  'attribute_pair_stats', 'attribute_vote_events', 'rule_revisions',
  'legacy_import_rows',
];
const historyRead = new RegExp('\\b(?:FROM|JOIN)\\s+(?:"|\\x60|\\[)?(' + historyTables.join('|') + ')\\b', 'iu');

export const auditTriggerFanout = (db) => {
  const violations = [];
  for (const trigger of db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all()) {
    const sql = maskCommentsAndStrings(trigger.sql);
    if (historyRead.test(sql)) violations.push(`${trigger.name}: trigger reads a growing history table`);
    for (const statement of sql.split(';')) {
      for (const match of statement.matchAll(/\b(?:FROM|JOIN)\s+attribute_subjects(?:\s+(?:AS\s+)?([a-z_][a-z_0-9]*))?/giu)) {
        const alias = /^(?:WHERE|ON|JOIN|LEFT|RIGHT|INNER|CROSS|ORDER|GROUP|LIMIT)$/iu.test(match[1] ?? '')
          ? 'attribute_subjects' : match[1] ?? 'attribute_subjects';
        const indexedKey = new RegExp(`\\b${alias}\\.(?:id|game_id)\\s*(?:=|IN\\s*\\()`, 'iu');
        if (!indexedKey.test(statement)) {
          violations.push(`${trigger.name}: trigger scans attribute_subjects without an indexed subject or game key`);
        }
      }
    }
    violations.push(...unsafeDeletes(db, trigger.sql, `trigger ${trigger.name}`));
  }
  return violations;
};

export const auditPendingMigrationDeletes = (db, pendingNames) => {
  const violations = [];
  for (const name of pendingNames) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/u.test(name) || !migrationNames().includes(name)) {
      violations.push(`Unknown pending migration: ${name}`);
      continue;
    }
    const sql = readFileSync(`migrations/${name}`, 'utf8');
    if (deleteTargets(sql).length && /\bDROP\s+INDEX\b/iu.test(maskCommentsAndStrings(sql))) {
      violations.push(`${name}: a migration may not drop indexes around a DELETE; split and review it explicitly`);
    }
    violations.push(...unsafeDeletes(db, sql, name));
  }
  return violations;
};

export const checkD1TriggerFanout = (pendingNames = []) => {
  const db = buildMigratedSchema();
  try {
    const violations = [...auditTriggerFanout(db), ...auditPendingMigrationDeletes(db, pendingNames)];
    if (violations.length) throw new Error(`D1 fanout guard failed:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  } finally {
    db.close();
  }
};

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-d1-trigger-fanout.mjs')) {
  try {
    checkD1TriggerFanout();
    console.log('✅ D1 trigger fanout guard passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
