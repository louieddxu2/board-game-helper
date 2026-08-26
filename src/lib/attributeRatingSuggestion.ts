import type { AttributeComparisonResult } from '../shared/types';

export const suggestedComparisonForRatings = (ratingA: string, ratingB: string): AttributeComparisonResult | null => {
  if (ratingA === '' || ratingB === '') return null;
  const left = Number(ratingA);
  const right = Number(ratingB);
  if (left > right) return 'A_HIGHER';
  if (right > left) return 'B_HIGHER';
  return 'SIMILAR';
};
