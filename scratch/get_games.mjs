import { spawnSync } from 'child_process';
import fs from 'fs';

const result = spawnSync('npx.cmd', ['wrangler', 'd1', 'execute', 'board-game-rules-local', '--local', '--command', 'SELECT id, slug, display_name, english_name FROM games WHERE merged_into_game_id IS NULL ORDER BY display_name;'], { encoding: 'utf8' });

const stdout = result.stdout;
const lines = stdout.split('\n');
const start = lines.findIndex(l => l.includes('┌') || l.includes('[')) ;
console.log(stdout);
