import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

const declarationsFor = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('catalog mobile rule layout', () => {
  test('preserves authored line breaks in the left column', () => {
    expect(declarationsFor('.catalog-mobile-rule-statement')).toMatch(/white-space:\s*pre-wrap/);
    expect(declarationsFor('.catalog-mobile-rule-section p, .catalog-mobile-rule-meta p')).toMatch(/white-space:\s*pre-wrap/);
  });

  test('keeps metadata content inside a slightly wider right column', () => {
    expect(declarationsFor('.catalog-mobile-rule-card')).toMatch(/clamp\(88px,\s*27vw,\s*108px\)/);
    expect(declarationsFor('.catalog-mobile-rule-meta > div, .catalog-mobile-rule-meta p')).toMatch(/min-width:\s*0/);
    expect(declarationsFor('.catalog-mobile-rule-meta .catalog-rule-category-list span, .catalog-mobile-rule-meta .catalog-rule-tag-list span')).toMatch(/box-sizing:\s*border-box/);
  });
});
