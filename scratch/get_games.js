const { execSync } = require('child_process');
const fs = require('fs');

try {
  const out = execSync('npx wrangler d1 execute board-game-rules-local --local --json --command="SELECT id, slug, display_name, english_name FROM games WHERE merged_into_game_id IS NULL ORDER BY display_name;"', { encoding: 'utf8' });
  // Find JSON array in output
  const jsonStart = out.indexOf('[');
  if (jsonStart !== -1) {
    const data = JSON.parse(out.slice(jsonStart))[0].results;
    console.log('Successfully fetched ' + data.length + ' games');
    fs.writeFileSync('scratch/games.json', JSON.stringify(data, null, 2));
  } else {
    console.log('Output:', out);
  }
} catch (e) {
  console.error('Error:', e.message);
  if (e.stdout) console.log('stdout:', e.stdout);
  if (e.stderr) console.log('stderr:', e.stderr);
}
