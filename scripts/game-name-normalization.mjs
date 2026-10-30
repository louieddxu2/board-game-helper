import { normalizeName } from '../src/shared/nameNormalization.ts';

export const gameNameRepairs = (games, aliases) => [
  ...games.filter((row) => row.normalized_name !== normalizeName(row.display_name))
    .map((row) => ({ table: 'games', id: row.id, name: row.display_name, key: normalizeName(row.display_name) })),
  ...aliases.filter((row) => row.normalized_alias !== normalizeName(row.alias))
    .map((row) => ({ table: 'game_aliases', id: row.id, name: row.alias, key: normalizeName(row.alias) })),
];

export const checkGameNameNormalization = (sqlite) => {
  const repairs = gameNameRepairs(
    sqlite.prepare('SELECT id, display_name, normalized_name FROM games').all(),
    sqlite.prepare('SELECT id, alias, normalized_alias FROM game_aliases').all(),
  );
  if (repairs.length) throw new Error(`Noncanonical stored game names:\n${repairs.map((row) => `${row.table}:${row.id}`).join('\n')}`);
};

export const gameNameRepairSql = (repairs) => {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  return repairs.map((row) => {
    const nameColumn = row.table === 'games' ? 'display_name' : 'alias';
    const keyColumn = row.table === 'games' ? 'normalized_name' : 'normalized_alias';
    return `UPDATE ${row.table} SET ${keyColumn} = ${quote(row.key)} WHERE id = ${quote(row.id)} AND ${nameColumn} = ${quote(row.name)} AND ${keyColumn} <> ${quote(row.key)};`;
  }).join('\n');
};
