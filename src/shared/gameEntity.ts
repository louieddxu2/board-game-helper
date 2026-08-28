export const GAME_ENTITY_KINDS = ['base', 'expansion', 'version', 'unknown'] as const;

export type GameEntityKind = (typeof GAME_ENTITY_KINDS)[number];

const EXPANSION_MARKERS = ['expansion', 'expansions', '擴充', '擴展', '擴'];
const VERSION_MARKERS = [
  'edition',
  'revised',
  'revision',
  'second edition',
  'third edition',
  'fourth edition',
  'deluxe edition',
  'collector edition',
  "collector's edition",
  'big box',
  '版本',
  '修訂版',
  '新版',
  '第二版',
  '第三版',
  '第四版',
  '豪華版',
  '精裝版',
  '典藏版',
];

export function normalizeGameEntityLabel(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-Hant')
    .replaceAll('擴充', '擴')
    .replaceAll('擴展', '擴')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function classifyGameEntityLabel(value: string | null | undefined): GameEntityKind {
  const label = value?.normalize('NFKC').trim().toLocaleLowerCase('zh-Hant') ?? '';
  if (!label) return 'unknown';
  if (EXPANSION_MARKERS.some((marker) => label.includes(marker))) return 'expansion';
  if (VERSION_MARKERS.some((marker) => label.includes(marker))) return 'version';
  return 'unknown';
}
