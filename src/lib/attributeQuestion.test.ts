import { describe, expect, test } from 'vitest';
import { ATTRIBUTE_QUESTION_ENDINGS, attributeQuestionEnding } from './attributeQuestion';

describe('attributeQuestionEnding', () => {
  test('provides intentional wording for every current attribute', () => {
    expect(Object.keys(ATTRIBUTE_QUESTION_ENDINGS)).toHaveLength(26);
    expect(attributeQuestionEnding('cooperation')).toBe('較多');
    expect(attributeQuestionEnding('setup_variability')).toBe('幅度較大');
    expect(attributeQuestionEnding('systemic_coherence')).toBe('較強');
    expect(attributeQuestionEnding('waiting_for_thinking')).toBe('時間較長');
    expect(attributeQuestionEnding('real_time_reaction')).toBe('要求較高');
  });

  test('uses a grammatical fallback for future attributes', () => {
    expect(attributeQuestionEnding('future_attribute')).toBe('程度較高');
  });
});
