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

  it('keeps the frozen header layer above body content during automatic scrolling', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const tableRule = styles.match(/\.workspace-table\s*\{([^}]*)\}/)?.[1];
    const theadRule = styles.match(/\.workspace-table thead\s*\{([^}]*)\}/)?.[1];
    const tbodyRule = styles.match(/\.workspace-table tbody\s*\{([^}]*)\}/)?.[1];
    const headerCellRule = styles.match(/\.workspace-table thead th\s*\{([^}]*)\}/)?.[1];

    expect(tableRule).toMatch(/isolation:\s*isolate/);
    expect(theadRule).toMatch(/z-index:\s*4/);
    expect(tbodyRule).toMatch(/z-index:\s*1/);
    expect(headerCellRule).toMatch(/z-index:\s*6/);
  });

  it('centers value editors independently from table text scaling', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const valueOverlayRule = styles.match(/\.workspace-value-dialog-overlay\s*\{([^}]*)\}/)?.[1];
    const valueInputRule = styles.match(/\.workspace-value-dialog \.workspace-value-input\s*\{([^}]*)\}/)?.[1];
    const appbarTitleRule = styles.match(/\.workspace-appbar-title span\s*\{([^}]*)\}/)?.[1];
    const overlayRule = styles.match(/\.workspace-overlay\s*\{([^}]*)\}/)?.[1];
    const dialogRule = styles.match(/\.workspace-dialog\s*\{([^}]*)\}/)?.[1];
    const selectionDialogRule = styles.match(/\.workspace-selection-dialog\s*\{([^}]*)\}/)?.[1];
    const selectionListRule = styles.match(/\.workspace-selection-list button\s*\{([^}]*)\}/)?.[1];
    const selectionCheckboxRule = styles.match(/\.workspace-selection-checkbox-item\s*\{([^}]*)\}/)?.[1];
    const dragSurfaceRule = styles.match(/\.workspace-table-viewport, \.workspace-table-viewport \*, \.workspace-tree, \.workspace-tree \*\s*\{([^}]*)\}/)?.[1];
    const editableSurfaceRule = styles.match(/\.workspace-dialog input, \.workspace-dialog textarea, \.workspace-dialog select, \.workspace-dialog \[contenteditable="true"\]\s*\{([^}]*)\}/)?.[1];

    expect(valueOverlayRule).toMatch(/place-items:\s*center/);
    expect(valueInputRule).toMatch(/font-size:\s*28px/);
    expect(valueInputRule).not.toContain('--workspace-text-scale');
    expect(appbarTitleRule).toMatch(/font-size:\s*24px/);
    expect(appbarTitleRule).toMatch(/line-height:\s*1\.2/);
    expect(overlayRule).toMatch(/font-size:\s*16px/);
    expect(overlayRule).toMatch(/--workspace-text-scale:\s*1/);

    const filterRule = styles.match(/\.workspace-header-filter\s*\{([^}]*)\}/)?.[1];
    expect(dialogRule).toMatch(/font-size:\s*16px/);
    expect(dialogRule).toMatch(/--workspace-text-scale:\s*1/);
    expect(selectionDialogRule).toMatch(/background:\s*rgba\(255,253,248,\.62\)/);
    expect(selectionDialogRule).not.toMatch(/backdrop-filter/);
    expect(selectionListRule).toMatch(/background:\s*rgba\(255,253,248,\.38\)/);
    expect(selectionCheckboxRule).toMatch(/grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)/);
    expect(dragSurfaceRule).toMatch(/user-select:\s*none/);
    expect(dragSurfaceRule).toMatch(/-webkit-touch-callout:\s*none/);
    expect(editableSurfaceRule).toMatch(/user-select:\s*text/);
    expect(filterRule).toMatch(/position:\s*absolute/);
    expect(filterRule).toMatch(/min-height:\s*20px/);
    expect(filterRule).toMatch(/opacity:\s*\.42/);
    expect(filterRule).not.toMatch(/flex:\s*0 0/);
    expect(styles).not.toContain('.workspace-empty-cell::after');
  });

  it('keeps every workspace dialog and input surface translucent without background blur', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const overlayRule = styles.match(/\.workspace-overlay\s*\{([^}]*)\}/)?.[1];
    const dialogRule = styles.match(/\.workspace-dialog\s*\{([^}]*)\}/)?.[1];
    const inputRule = styles.match(/\.workspace-dialog textarea, \.workspace-dialog input, \.workspace-dialog select\s*\{([^}]*)\}/)?.[1];

    expect(overlayRule).toMatch(/background:\s*transparent/);
    expect(dialogRule).toMatch(/background:\s*rgba\(/);
    expect(dialogRule).toMatch(/backdrop-filter:\s*none/);
    expect(inputRule).toMatch(/background:\s*rgba\(/);
    expect(styles).not.toMatch(/\.workspace-(?:name|cell-name|value|link)-dialog[^{}]*\{[^}]*backdrop-filter:\s*blur/);
  });

  it('expands proportional allocation without resizing the number editor', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const valueDialogRule = styles.match(/\.workspace-value-dialog\s*\{([^}]*)\}/)?.[1];
    const ratioPanelRule = styles.match(/\.workspace-ratio-panel\s*\{([^}]*)\}/)?.[1];

    expect(valueDialogRule).toMatch(/width:\s*min\(360px,\s*50vw\)/);
    expect(styles).not.toMatch(/\.workspace-bulk-number-dialog\.is-expanded\s*\{[^}]*width:/);
    expect(ratioPanelRule).toMatch(/box-sizing:\s*border-box/);
    expect(ratioPanelRule).toMatch(/width:\s*100%/);
    expect(ratioPanelRule).not.toMatch(/justify-self/);
  });
});
