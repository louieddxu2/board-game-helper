import { describe, expect, it } from 'vitest';
import { missingRequiredSecrets } from './deploy-preflight.mjs';

describe('deployment secret preflight', () => {
  it('reports every production secret that is absent', () => {
    expect(missingRequiredSecrets([
      { name: 'ATTRIBUTE_QUESTION_SECRET', type: 'secret_text' },
    ])).toEqual(['EMAIL_HASH_SECRET']);
  });

  it('passes when all required production secrets exist', () => {
    expect(missingRequiredSecrets([
      { name: 'ATTRIBUTE_QUESTION_SECRET', type: 'secret_text' },
      { name: 'EMAIL_HASH_SECRET', type: 'secret_text' },
    ])).toEqual([]);
  });
});
