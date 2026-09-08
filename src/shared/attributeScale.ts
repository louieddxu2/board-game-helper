import { z } from 'zod';

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
