const { execSync } = require('child_process');

try {
  const out = execSync(`npx wrangler d1 execute board-game-rules-prod --remote --config wrangler.production.jsonc --command="SELECT r.id, g.display_name game_name, g.slug game_slug, r.statement, r.status, r.created_at, r.updated_at FROM rules r JOIN games g ON g.id = r.game_id LIMIT 10;"`, { encoding: 'utf8' });
  console.log(out);
} catch (e) {
  console.error(e);
}
