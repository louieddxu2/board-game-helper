import { z } from 'zod';
import type { AttributeComparisonResult, AttributePole } from './types';

/** Symmetric: converts either displayed to canonical or canonical to displayed. */
export const orientAttributeScore = (score: number, highPole: AttributePole = 'high') =>
  highPole === 'low' ? 10 - score : score;

export const orientAttributeComparison = (
  result: AttributeComparisonResult | null | undefined,
  highPole: AttributePole = 'high',
) => highPole === 'low' && result != null && result !== 'SIMILAR'
  ? result === 'A_HIGHER' ? 'B_HIGHER' as const : 'A_HIGHER' as const
  : result;

/** Answers arrive in display coordinates. Call once before scoring or caching. */
export const canonicalAttributeAnswer = <T extends {
  highPole?: AttributePole;
  ratingA?: number | null;
  ratingB?: number | null;
  comparison?: AttributeComparisonResult | null;
}>(input: T) => ({
  ...input,
  ratingA: input.ratingA == null ? input.ratingA : orientAttributeScore(input.ratingA, input.highPole),
  ratingB: input.ratingB == null ? input.ratingB : orientAttributeScore(input.ratingB, input.highPole),
  comparison: orientAttributeComparison(input.comparison, input.highPole),
});

const endpoint = z.object({
  label: z.string().trim().min(1),
  question: z.string().trim().min(1),
  shortDescription: z.string().optional(),
  fullDescription: z.string().optional(),
});

const endpoints = z.object({ low: endpoint, high: endpoint });

/** Legacy payloads have no metadata; incomplete bipolar definitions fail closed. */
export const parseAttributeScale = (scaleType: unknown, value: unknown) => {
  if (scaleType == null || scaleType === 'unipolar') return {};
  if (scaleType !== 'bipolar') throw new Error('invalid_attribute_scale_type');
  const parsed = endpoints.safeParse(value);
  if (!parsed.success) throw new Error('invalid_attribute_endpoints');
  return { scaleType: 'bipolar' as const, endpoints: parsed.data };
};
