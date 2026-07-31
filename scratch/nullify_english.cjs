const { execSync } = require('child_process');
const fs = require('fs');

const sqlFile = 'scratch/nullify_duplicate_english.sql';
const sqlContent = `UPDATE games SET english_name = NULL WHERE lower(display_name) = lower(english_name) AND merged_into_game_id IS NULL;`;
fs.writeFileSync(sqlFile, sqlContent, 'utf8');

console.log('Executing SQL to set english_name = NULL for games that only have english name...');
