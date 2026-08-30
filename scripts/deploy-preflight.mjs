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
