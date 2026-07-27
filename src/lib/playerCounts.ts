export const normalizePlayerCounts = (counts: number[]): number[] => Array.from(new Set(counts
  .filter((count) => Number.isInteger(count) && count >= 1 && count <= 8)))
  .sort((left, right) => left - right);

export const formatPlayerCounts = (counts: number[]): string => {
  const ranges: Array<[number, number]> = [];
  for (const count of normalizePlayerCounts(counts)) {
    const current = ranges[ranges.length - 1];
    if (current && count === current[1] + 1) current[1] = count;
    else ranges.push([count, count]);
  }
  return ranges.map(([start, end]) => start === end ? `${start}人` : `${start}~${end}人`).join('、');
};
