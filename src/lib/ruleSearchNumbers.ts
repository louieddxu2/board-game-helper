const digits = '零一二三四五六七八九';
const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const units = [['億', 1e8], ['萬', 1e4], ['千', 1000], ['百', 100], ['十', 10]] as const;
const numberCharacters = '0-9０-９零〇一二兩三四五六七八九十百千萬億';
const numberTokens = new RegExp(`([${numberCharacters}]+)`, 'u');
const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const digitWidths = (text: string) => text.replace(/[0-9]/gu, digit =>
  `[${digit}${String.fromCharCode(digit.charCodeAt(0) + 0xfee0)}]`);

/** Spell a whole quantity in Taiwanese Mandarin (including zeros between place values). */
function spellQuantity(value: number): string {
  for (const [unit, size] of units) {
    if (value < size) continue;
    const remainder = value % size;
    const gap = remainder && remainder < size / 10 ? '零' : '';
    return spellQuantity(Math.floor(value / size)) + unit + (remainder ? gap + spellQuantity(remainder) : '');
  }
  return digits[value];
}

function chineseValue(text: string): number | undefined {
  let total = 0, group = 0, digit = 0;
  for (const char of text) {
    if (char === '億' || char === '萬') {
      total += (group + digit) * (char === '億' ? 1e8 : 1e4);
      group = digit = 0;
    } else if (char in smallUnits) {
      group += (digit || 1) * smallUnits[char];
      digit = 0;
    } else {
      digit = digits.indexOf(char);
    }
  }
  const value = total + group + digit;
  // Colloquial sequences such as 一兩 or 三四 are not an exact quantity.
  const spelled = spellQuantity(value);
  return spelled === text || spelled.replace(/^一十/u, '十') === text ? value : undefined;
}

function quantityPattern(token: string) {
  if (token !== '兩' && /兩(?![百千萬億])/u.test(token)) return digitWidths(token.normalize('NFKC'));
  const normalized = token.normalize('NFKC').replaceAll('兩', '二').replaceAll('〇', '零');
  const arabic = /^[0-9]+$/u.test(normalized);
  const shorthand = normalized.match(/^([1-9][0-9]*)([十百千萬億])$/u);
  if (!arabic && !shorthand && /[0-9]/u.test(normalized)) return digitWidths(token.normalize('NFKC'));
  const multiplier = units.find(([unit]) => unit === shorthand?.[2]);
  const value = shorthand && multiplier ? Number(shorthand[1]) * multiplier[1]
    : arabic ? Number(normalized) : chineseValue(normalized);
  if (value === undefined) return token;
  if (shorthand && !Number.isSafeInteger(value)) return digitWidths(normalized);
  const decimal = arabic ? normalized : String(value);
  const forms = [digitWidths(decimal)];
  if (decimal === String(value) && value < 1e12) {
    const chinese = spellQuantity(value).replace(/^一十/u, '一?十').replaceAll('零', '[零〇]')
      .replace(/二(?=[百千萬億])|^二$/gu, '[二兩]');
    forms.push(chinese);
    if (value > 0) {
      for (const [unit, size] of units) {
        if (value % size === 0) forms.push(digitWidths(String(value / size)) + unit);
      }
    }
  } else if (shorthand) {
    forms.push(digitWidths(normalized));
  }
  // A search for 三元 must not match the last digit of 13元 or 十三元.
  return `(?<![${numberCharacters}])(?:${forms.join('|')})(?![${numberCharacters}])`;
}

/** Non-numeric text stays literal. Chinese units can sit next to a quantity or follow a space. */
export function ruleSearchSource(query: string) {
  const parts = query.split(numberTokens);
  return parts.map((part, index) => {
    if (index % 2) return quantityPattern(part);
    const spaceBefore = index > 0 && /^[ \t　]*\p{Script=Han}/u.test(part);
    const spaceAfter = index < parts.length - 1 && /\p{Script=Han}[ \t　]*$/u.test(part);
    const literal = escapeLiteral(part);
    const start = spaceBefore ? '[ \\t　]*' + literal.trimStart() : literal;
    return spaceAfter ? start.trimEnd() + '[ \\t　]*' : start;
  }).join('');
}
