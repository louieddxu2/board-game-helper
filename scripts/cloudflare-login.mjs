import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XDG_CONFIG_HOME = path.join(PROJECT_ROOT, '.wrangler', 'xdg');
const WRANGLER_COMMAND = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const AUTH_URL_PATTERN = /https:\/\/dash\.cloudflare\.com\/oauth2\/auth\?[^\s"'<>]+/;

export const WRANGLER_LOGIN_ARGS = Object.freeze([
  'wrangler',
  'login',
  '--no-use-keyring',
  '--browser=false',
]);

const wranglerEnvironment = () => ({
  ...process.env,
  XDG_CONFIG_HOME,
});

const stripAnsi = (value) => value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');

export const extractAuthUrl = (output) => stripAnsi(output).match(AUTH_URL_PATTERN)?.[0] ?? null;

// Keep the OAuth callback and browser launch in the same Wrangler login process.
// On managed Windows, cmd.exe browser launches and direct npx.cmd status checks
// can fail with EINVAL; PowerShell Start-Process and shell-backed npx are the
// verified release path.
const openWindowsBrowser = (url) => new Promise((resolve, reject) => {
  const escapedUrl = url.replaceAll("'", "''");
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${escapedUrl}'`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('spawn', () => {
    child.unref();
    resolve();
  });
});

const openUnixBrowser = (url) => new Promise((resolve, reject) => {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore' });
  child.once('error', reject);
  child.once('spawn', () => {
    child.unref();
    resolve();
  });
});

export const openDefaultBrowser = (url) => process.platform === 'win32'
  ? openWindowsBrowser(url)
  : openUnixBrowser(url);

const runWrangler = (args, options = {}) => {
  const result = spawnSync(WRANGLER_COMMAND, args, {
    cwd: PROJECT_ROOT,
    env: wranglerEnvironment(),
    stdio: options.stdio ?? 'ignore',
    windowsHide: false,
    shell: process.platform === 'win32',
    ...options,
  });
  return result;
};

export const hasCloudflareAuth = () => Boolean(process.env.CLOUDFLARE_API_TOKEN)
  || runWrangler(['wrangler', 'whoami']).status === 0;

export const runLogin = () => new Promise((resolve, reject) => {
  const child = spawn(WRANGLER_COMMAND, WRANGLER_LOGIN_ARGS, {
    cwd: PROJECT_ROOT,
    env: wranglerEnvironment(),
    stdio: ['inherit', 'pipe', 'inherit'],
    windowsHide: false,
  });

  let output = '';
  let browserOpened = false;
  let browserError = null;

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    output = `${output}${text}`.slice(-20000);

    if (!browserOpened) {
      const url = extractAuthUrl(output);
      if (url) {
        browserOpened = true;
        console.log('\n🌐 已在等待中的 Wrangler 流程中開啟 Cloudflare 授權頁。');
        openDefaultBrowser(url).catch((error) => {
          browserError = error;
          console.error(`\n❌ 無法自動開啟預設瀏覽器：${error.message}`);
          console.error(`請手動開啟上方 Wrangler 顯示的網址。`);
        });
      }
    }
  });

  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (browserError) {
      reject(browserError);
      return;
    }
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`Cloudflare Wrangler login failed${signal ? ` (${signal})` : ` (exit code ${code})`}.`));
  });
});

export const ensureCloudflareAuth = async () => {
  if (hasCloudflareAuth()) {
    console.log('✅ Cloudflare Wrangler 已有可用登入狀態。');
    return;
  }

  console.log('🔐 Cloudflare Wrangler 登入狀態已失效，啟動固定的瀏覽器授權流程...');
  await runLogin();
};

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runLogin()
    .then(() => console.log('✅ Cloudflare Wrangler 登入完成。'))
    .catch((error) => {
      console.error(`❌ Cloudflare Wrangler 登入失敗：${error.message}`);
      process.exitCode = 1;
    });
}
