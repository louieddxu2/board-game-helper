import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import readline from 'readline';
import { ensureCloudflareAuth } from './cloudflare-login.mjs';
import { detectAuthSensitiveReleaseChanges, missingRequiredSecrets, parseSecretList } from './deploy-preflight.mjs';

const DEPLOY_STATE_PATH = '.wrangler/last-successful-deploy-sha';

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

const currentGitSha = () => run('git rev-parse HEAD').trim();

const releaseComparisonBase = (currentSha) => {
  try {
    const recorded = readFileSync(DEPLOY_STATE_PATH, 'utf8').trim();
    if (/^[0-9a-f]{40}$/u.test(recorded)) {
      run(`git merge-base --is-ancestor ${recorded} ${currentSha}`);
      return recorded;
    }
  } catch { /* First guarded release or recorded commit is unavailable. */ }
  return run('git rev-parse HEAD^').trim();
};

const checkAuthSensitiveReleaseChanges = () => {
  const currentSha = currentGitSha();
  const baseSha = releaseComparisonBase(currentSha);
  const changedFiles = run(`git diff --name-only ${baseSha}`).split(/\r?\n/u).filter(Boolean);
  const diff = run(`git diff --unified=0 ${baseSha}`, { maxBuffer: 8 * 1024 * 1024 });
  const report = detectAuthSensitiveReleaseChanges({ changedFiles, diff });
  if (report.warnings.length === 0) {
    console.log('✅ 本次差異未碰觸 Google 登入與正式驗證設定。');
  } else {
    console.log('\n⚠️ 本次發布包含可能影響 Google 登入的修改：');
    report.warnings.forEach((warning) => console.log(`   - ${warning}`));
    console.log('   發布流程將繼續檢查必要 Secret 與 migration；請確認新增綁定也已登記於 REQUIRED_PRODUCTION_SECRETS。\n');
  }
  return currentSha;
};

const recordSuccessfulDeploy = (sha) => {
  mkdirSync('.wrangler', { recursive: true });
  writeFileSync(DEPLOY_STATE_PATH, `${sha}\n`, 'utf8');
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
  console.log('🛡️ 正在檢查本次差異是否影響 Google 登入...');
  const deployingSha = checkAuthSensitiveReleaseChanges();
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
  recordSuccessfulDeploy(deployingSha);
  console.log('\n🎉 部署流程完全結束！');
};

main().catch((err) => {
  console.error('\n❌ 部署中斷：', err.message || err);
  process.exit(1);
});
