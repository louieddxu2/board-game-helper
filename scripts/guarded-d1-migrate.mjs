import { execSync } from 'node:child_process';
import { checkD1TriggerFanout } from './check-d1-trigger-fanout.mjs';
import { listPendingRemoteMigrations } from './d1-migration-list.mjs';

try {
  const pending = listPendingRemoteMigrations();
  checkD1TriggerFanout(pending);
  if (pending.length === 0) {
    console.log('✅ No pending D1 migrations.');
  } else {
    console.log(`✅ D1 fanout guard passed for ${pending.length} pending migration(s).`);
    execSync('cross-env XDG_CONFIG_HOME=.wrangler/xdg wrangler d1 migrations apply board-game-rules-prod --remote --config wrangler.production.jsonc', {
      stdio: 'inherit',
    });
  }
} catch (error) {
  console.error('❌ D1 migration blocked:', error.message);
  process.exitCode = 1;
}
