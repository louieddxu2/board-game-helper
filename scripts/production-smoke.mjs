import { readFileSync } from 'node:fs';

export const productionReleaseConfig = (source) => {
  const value = (name) => source.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`, 'u'))?.[1];
  const origin = value('APP_ORIGIN');
  const googleClientId = value('GOOGLE_CLIENT_ID');
  if (!origin || !googleClientId) throw new Error('wrangler.production.jsonc 缺少 APP_ORIGIN 或 GOOGLE_CLIENT_ID。');
  return { origin: origin.replace(/\/$/u, ''), googleClientId };
};

export const assertProductionSmoke = async ({ origin, googleClientId }, fetchImpl = fetch) => {
  const [healthResponse, sessionResponse, shellResponse] = await Promise.all([
    fetchImpl(`${origin}/api/health`, { headers: { Accept: 'application/json' } }),
    fetchImpl(`${origin}/api/session`, { headers: { Accept: 'application/json' } }),
    fetchImpl(`${origin}/login`, { headers: { Accept: 'text/html' } }),
  ]);
  if (!healthResponse.ok || !(await healthResponse.json()).ok) throw new Error(`正式站健康檢查失敗：HTTP ${healthResponse.status}`);
  if (!sessionResponse.ok) throw new Error(`正式站 Session API 失敗：HTTP ${sessionResponse.status}`);
  const session = await sessionResponse.json();
  if (session.googleClientId !== googleClientId) throw new Error('正式站 Google Client ID 與發布設定不一致。');
  if (session.localDevLogin !== false) throw new Error('正式站錯誤地開啟了本機登入。');
  if (!shellResponse.ok) throw new Error(`正式站登入頁無法載入：HTTP ${shellResponse.status}`);
  const csp = shellResponse.headers.get('content-security-policy') ?? '';
  if (!csp.includes('https://accounts.google.com/gsi/client') || !csp.includes('frame-src https://accounts.google.com/gsi/')) {
    throw new Error('正式站 CSP 未完整允許 Google Identity Services。');
  }
};

const main = async () => {
  const config = productionReleaseConfig(readFileSync('wrangler.production.jsonc', 'utf8'));
  await assertProductionSmoke(config);
  console.log(`✅ 正式站核心 smoke test 通過：${config.origin}`);
};

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  main().catch((error) => {
    console.error(`❌ 正式站核心 smoke test 失敗：${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
