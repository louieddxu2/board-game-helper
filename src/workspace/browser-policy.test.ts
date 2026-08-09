import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace browser policies', () => {
  it('allows the blob worker used to unzip larger Excel workbooks', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const contentSecurityPolicy = headers.split(/\r?\n/).find((line) => line.trimStart().startsWith('Content-Security-Policy:'));

    expect(contentSecurityPolicy).toContain("worker-src 'self' blob:");
  });

  it('constrains the workspace to the viewport so the table owns vertical scrolling', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const workspacePageRule = styles.match(/\.workspace-page\s*\{([^}]*)\}/)?.[1];

    expect(workspacePageRule).toMatch(/(?:^|;)\s*height:\s*100dvh/);
  });

  it('keeps both table axes sticky while their headings support reordering', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const columnReorderRule = styles.match(/\.workspace-table th\[data-column-id\][^{]*\{([^}]*)\}/)?.[1];
    const rowReorderRule = styles.match(/\.workspace-row-heading\[data-row-id\][^{]*\{([^}]*)\}/)?.[1];

    expect(columnReorderRule).toMatch(/position:\s*sticky/);
    expect(columnReorderRule).toMatch(/top:\s*0/);
    expect(rowReorderRule).toMatch(/position:\s*sticky/);
    expect(rowReorderRule).toMatch(/left:\s*0/);
  });
});
