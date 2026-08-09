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
    const columnReorderRule = styles.match(/\.workspace-table:not\(\.is-transposed\) thead th\[data-column-id\][^{]*\{([^}]*)\}/)?.[1];
    const rowReorderRule = styles.match(/\.workspace-table:not\(\.is-transposed\) \.workspace-row-heading\[data-row-id\][^{]*\{([^}]*)\}/)?.[1];
    const transposedRowRule = styles.match(/\.workspace-table\.is-transposed thead th\[data-row-id\][^{]*\{([^}]*)\}/)?.[1];
    const transposedColumnRule = styles.match(/\.workspace-table\.is-transposed tbody th\[data-column-id\][^{]*\{([^}]*)\}/)?.[1];

    expect(columnReorderRule).toMatch(/position:\s*sticky/);
    expect(columnReorderRule).toMatch(/top:\s*0/);
    expect(rowReorderRule).toMatch(/position:\s*sticky/);
    expect(rowReorderRule).toMatch(/left:\s*0/);
    expect(transposedRowRule).toMatch(/position:\s*sticky/);
    expect(transposedRowRule).toMatch(/top:\s*0/);
    expect(transposedColumnRule).toMatch(/position:\s*sticky/);
    expect(transposedColumnRule).toMatch(/left:\s*0/);
  });

  it('centers value editors independently from table text scaling', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const valueOverlayRule = styles.match(/\.workspace-value-dialog-overlay\s*\{([^}]*)\}/)?.[1];
    const valueInputRule = styles.match(/\.workspace-value-dialog \.workspace-value-input\s*\{([^}]*)\}/)?.[1];
    const appbarTitleRule = styles.match(/\.workspace-appbar-title span\s*\{([^}]*)\}/)?.[1];
    const overlayRule = styles.match(/\.workspace-overlay\s*\{([^}]*)\}/)?.[1];
    const dialogRule = styles.match(/\.workspace-dialog\s*\{([^}]*)\}/)?.[1];

    expect(valueOverlayRule).toMatch(/place-items:\s*center/);
    expect(valueInputRule).toMatch(/font-size:\s*28px/);
    expect(valueInputRule).not.toContain('--workspace-text-scale');
    expect(appbarTitleRule).toMatch(/font-size:\s*17px/);
    expect(overlayRule).toMatch(/font-size:\s*16px/);
    expect(overlayRule).toMatch(/--workspace-text-scale:\s*1/);

    const filterRule = styles.match(/\.workspace-header-filter\s*\{([^}]*)\}/)?.[1];
    expect(dialogRule).toMatch(/font-size:\s*16px/);
    expect(dialogRule).toMatch(/--workspace-text-scale:\s*1/);
    expect(filterRule).toMatch(/position:\s*absolute/);
    expect(filterRule).toMatch(/min-height:\s*20px/);
    expect(filterRule).toMatch(/opacity:\s*\.42/);
    expect(filterRule).not.toMatch(/flex:\s*0 0/);
  });
});
