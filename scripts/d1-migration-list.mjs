import { execSync } from 'node:child_process';

export const parsePendingMigrations = (output) => {
  if (/No migrations to (?:be applied|apply)/iu.test(output)) return [];
  const marker = output.indexOf('Migrations to be applied:');
  if (marker < 0) throw new Error('Cannot identify pending D1 migrations; refusing to assume the list is empty.');
  const section = output.slice(marker).split(/\r?\n/u);
  const pending = [];
  for (const line of section.slice(1)) {
    if (line.includes('└') && line.includes('┘')) break;
    const match = line.match(/│\s*(\d{4}_[a-z0-9_]+\.sql)\s*│/iu);
    if (match) pending.push(match[1]);
  }
  if (!section.some((line) => line.includes('└') && line.includes('┘'))) {
    throw new Error('Incomplete D1 migration list; refusing to apply migrations.');
  }
  return pending;
};

export const listPendingRemoteMigrations = () => parsePendingMigrations(
  execSync('cross-env XDG_CONFIG_HOME=.wrangler/xdg wrangler d1 migrations list board-game-rules-prod --remote --config wrangler.production.jsonc', {
    encoding: 'utf8',
  }),
);
