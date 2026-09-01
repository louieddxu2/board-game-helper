export const REQUIRED_PRODUCTION_SECRETS = [
  'ATTRIBUTE_QUESTION_SECRET',
  'EMAIL_HASH_SECRET',
];

export const missingRequiredSecrets = (secrets, required = REQUIRED_PRODUCTION_SECRETS) => {
  const available = new Set(secrets.map((secret) => typeof secret === 'string' ? secret : secret.name));
  return required.filter((name) => !available.has(name));
};

export const parseSecretList = (output) => {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error('Cloudflare Secret 清單格式不正確。');
  return parsed;
};

const AUTH_RUNTIME_FILES = new Set([
  'src/context/SessionContext.tsx',
  'src/pages/LoginPage.tsx',
  'worker/auth.ts',
  'worker/routes/auth.ts',
]);

const AUTH_CONFIGURATION_FILES = new Set([
  'public/_headers',
  'worker/env.ts',
  'wrangler.production.jsonc',
]);

export const detectAuthSensitiveReleaseChanges = ({ changedFiles = [], diff = '' } = {}) => {
  const normalizedFiles = changedFiles.map((file) => file.replaceAll('\\', '/'));
  const bindingLines = diff.split(/\r?\n/u).filter((line) => /^[+-](?![+-])/u.test(line));
  const environmentBindings = new Set();
  for (const line of bindingLines) {
    for (const match of line.matchAll(/\b(?:c\.)?env\.([A-Z][A-Z0-9_]+)/gu)) environmentBindings.add(match[1]);
    const declaration = line.match(/^[+-]\s*([A-Z][A-Z0-9_]+)\??:\s*/u);
    if (declaration) environmentBindings.add(declaration[1]);
  }

  const warnings = [];
  if (normalizedFiles.some((file) => AUTH_RUNTIME_FILES.has(file))
    || (normalizedFiles.includes('worker/utils.ts') && /\b(?:hashEmail|EMAIL_HASH_SECRET)\b/u.test(diff))) {
    warnings.push('Google 登入、帳號建立或 Session 必經路徑有修改');
  }
  if (normalizedFiles.some((file) => AUTH_CONFIGURATION_FILES.has(file))
    || /\b(?:GOOGLE_CLIENT_IDS?|APP_ORIGIN|TRUSTED_APP_ORIGINS|Content-Security-Policy|accounts\.google\.com)\b/u.test(diff)) {
    warnings.push('正式環境綁定、Google Client ID／來源或 CSP 有修改');
  }
  if (normalizedFiles.some((file) => file.startsWith('migrations/'))
    && /\b(?:users|sessions|user_roles|editor_invitations)\b/iu.test(diff)) {
    warnings.push('使用者、權限或 Session 資料庫結構有修改');
  }
  if (environmentBindings.size > 0) {
    warnings.push(`環境綁定有增刪：${[...environmentBindings].sort().join('、')}`);
  }

  return { environmentBindings: [...environmentBindings].sort(), warnings };
};
