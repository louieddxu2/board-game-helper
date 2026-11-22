// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The score pad app keeps exact copies of these files so it filters rules as the site does.
// When this test fails after a deliberate change: copy both files to the score pad, then update
// SHARED_RULE_FILTER_SHA256 here and in the score pad's matching test.
const SHARED_FILES = ['src/shared/ruleTypes.ts', 'src/shared/ruleFilter.ts'];
const SHARED_RULE_FILTER_SHA256 = '39b9a298a213021b4765f5891acaf0de96a242dafbbd90ce9fd59a68514e8d85';

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the rule filter shared with the score pad matches the recorded copy', () => {
  const hash = createHash('sha256');
  SHARED_FILES.forEach((file) => hash.update(read(file)));
  expect(hash.digest('hex')).toBe(SHARED_RULE_FILTER_SHA256);
});

test('the shared files import nothing beyond each other, so two files are the whole copy', () => {
  const imports = (file: string) => [...read(file).matchAll(/^(?:import|export)[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1]);
  expect(imports('src/shared/ruleTypes.ts')).toEqual([]);
  expect(imports('src/shared/ruleFilter.ts')).toEqual(['./ruleTypes']);
});
