export type DateFilterPrecision = 'year' | 'month' | 'day';
export type DateFilterParts = { year: number; month: number; day: number };

const pad = (value: number) => String(value).padStart(2, '0');
export const dateFilterDaysInMonth = (year: number, month: number) => {
  const date = new Date(0);
  date.setFullYear(year, month, 0);
  return date.getDate();
};

export const dateFilterParts = (value: string | undefined, fallback: DateFilterParts): DateFilterParts => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return fallback;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return parts.year >= 1 && parts.month >= 1 && parts.month <= 12 && parts.day >= 1 && parts.day <= dateFilterDaysInMonth(parts.year, parts.month) ? parts : fallback;
};

export const dateFilterBoundary = (parts: DateFilterParts, precision: DateFilterPrecision, end: boolean) => {
  const month = precision === 'year' ? end ? 12 : 1 : parts.month;
  const day = precision === 'day' ? parts.day : end ? dateFilterDaysInMonth(parts.year, month) : 1;
  return `${String(parts.year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
};

export const formatDateFilterBound = (value: string | undefined, precision: DateFilterPrecision) => {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return precision === 'year' ? `${Number(match[1])}年` : precision === 'month' ? `${Number(match[1])}/${Number(match[2])}` : `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
};
