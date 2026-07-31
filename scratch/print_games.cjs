const fs = require('fs');
const games = JSON.parse(fs.readFileSync('scratch/games.json', 'utf8'));
games.forEach((g, i) => {
  console.log(`${i + 1}. display: "${g.display_name}" | english: "${g.english_name || ''}"`);
});
