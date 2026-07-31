const fs = require('fs');
const games = JSON.parse(fs.readFileSync('scratch/remote_games.json', 'utf8'));
console.log('=== REMOTE PROD GAMES (' + games.length + ') ===');
games.forEach((g, i) => {
  console.log(`${i + 1}. display: "${g.display_name}" | english: "${g.english_name || ''}" | slug: "${g.slug}"`);
});
