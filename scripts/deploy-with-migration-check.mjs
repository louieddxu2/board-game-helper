import { execSync } from 'child_process';
import readline from 'readline';
import { ensureCloudflareAuth } from './cloudflare-login.mjs';
import { missingRequiredSecrets, parseSecretList } from './deploy-preflight.mjs';

const run = (command, options = {}) => {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: options.stdio ?? 'pipe', ...options });
  } catch (error) {
    if (options.allowFailure) return error.stdout ?? '';
    throw error;
  }
};

const checkPendingMigrations = () => {
  const output = run('cross-env XDG_CONFIG_HOME=.wrangler/xdg wrangler d1 migrations list board-game-rules-prod --remote --config wrangler.production.jsonc', { allowFailure: true });
  const lines = output.split('\n');
  const pending = [];
  let inSection = false;
  for (const line of lines) {
    if (line.includes('Migrations to be applied:')) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim().startsWith('│') && !line.includes('Name')) {
      const match = line.match(/│\s*([^\s│]+)\s*│/);
      if (match && match[1]) pending.push(match[1]);
    }
    if (inSection && line.includes('└') && line.includes('┘')) {
      inSection = false;
    }
  }
  return pending;
};

const checkRequiredSecrets = () => {
  const output = run('cross-env XDG_CONFIG_HOME=.wrangler/xdg wrangler secret list --format json --config wrangler.production.jsonc');
  const missing = missingRequiredSecrets(parseSecretList(output));
  if (missing.length === 0) return;
  const commands = missing.map((name) => `npx wrangler secret put ${name} --config wrangler.production.jsonc`).join('\n');
  throw new Error(`正式環境缺少必要 Secret：${missing.join('、')}\n請先執行：\n${commands}`);
};

const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
};

const main = async () => {
  await ensureCloudflareAuth();
  console.log('🔐 正在檢查正式環境必要 Secret...');
  checkRequiredSecrets();
  console.log('✅ 正式環境必要 Secret 已設定。');
  console.log('🔍 正在檢查遠端 Cloudflare D1 資料庫的 Migration 狀態...');
  const pending = checkPendingMigrations();
  const isCI = process.env.CI === 'true' || !process.stdin.isTTY;

  if (pending.length > 0) {
    console.log(`\n⚠️ 發現 ${pending.length} 個尚未套用到遠端的 Migration：`);
    pending.forEach((file) => console.log(`   - ${file}`));
    
    let applyDb = false;
    if (isCI) {
      console.log('🤖 偵測到 CI/非互動環境，自動跳過詢問並套用遠端 Migration...');
      applyDb = true;
    } else {
      const answer = await askQuestion('\n❓ 是否要在部署 Worker 前，先套用上述遠端 Migration？ [Y/n]: ');
      applyDb = answer === '' || answer === 'y' || answer === 'yes';
    }

    if (applyDb) {
      console.log('\n🚀 正在執行遠端 D1 Migration 套用...');
      execSync('npm run db:migrate:remote', { stdio: 'inherit' });
    } else {
      console.log('\n⚠️ 已選擇跳過遠端 Migration 套用，僅部署 Worker 程式碼。');
    }
  } else {
    console.log('✅ 遠端 D1 資料庫已是最新狀態，無需套用 Migration。');
  }

  console.log('\n📦 正在執行專案檢查、構建與 Worker 部署...');
  execSync('npm run deploy:code', { stdio: 'inherit' });
  console.log('\n🎉 部署流程完全結束！');
};

main().catch((err) => {
  console.error('\n❌ 部署中斷：', err.message || err);
  process.exit(1);
});
