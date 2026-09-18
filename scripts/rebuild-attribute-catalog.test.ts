// @vitest-environment node

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('operator catalog rebuild always runs the complete replay first', () => {
  const source = readFileSync('scripts/rebuild-attribute-catalog.ts', 'utf8');

  expect(source).toContain('runCompleteAttributeReplay');
  expect(source).not.toContain('rebuildAttributeCatalog');
  expect(source).not.toContain('queryAttributeTableSourcePayload');
});
