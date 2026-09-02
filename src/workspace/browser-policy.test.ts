import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workspace browser policies', () => {
  it('allows the blob worker used to unzip larger Excel workbooks', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const contentSecurityPolicy = headers.split(/\r?\n/).find((line) => line.trimStart().startsWith('Content-Security-Policy:'));

    expect(contentSecurityPolicy).toContain("worker-src 'self' blob:");
  });

  it('allows the Google Drive API used by workspace backups', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    const contentSecurityPolicy = headers.split(/\r?\n/).find((line) => line.trimStart().startsWith('Content-Security-Policy:'));

    expect(contentSecurityPolicy).toContain('https://www.googleapis.com');
  });

  it('offers the installed PWA a stable shortcut back to the main website', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { shortcuts?: Array<{ url?: string }> };
    expect(manifest.shortcuts?.some((shortcut) => shortcut.url === '/?pwa-entry=home')).toBe(true);
  });

  it('offers the installed PWA a long-press shortcut to attribute voting', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { shortcuts?: Array<{ name?: string; short_name?: string; url?: string }> };
    expect(manifest.shortcuts).toContainEqual(expect.objectContaining({ name: '開啟屬性投票', short_name: '屬性投票', url: '/attributes' }));
  });

  it('constrains the workspace to the viewport so the table owns vertical scrolling', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const workspacePageRule = styles.match(/\.workspace-page\s*\{([^}]*)\}/)?.[1];

    expect(workspacePageRule).toMatch(/(?:^|;)\s*height:\s*100dvh/);
  });

  it('reserves horizontal drawer swipes across the independently scrolling tree', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const drawerRule = styles.match(/\.workspace-drawer\s*\{([^}]*)\}/)?.[1];
    const treeRule = styles.match(/\.workspace-tree\s*\{([^}]*)\}/)?.[1];

    expect(drawerRule).toMatch(/touch-action:\s*pan-y/);
    expect(treeRule).toMatch(/touch-action:\s*pan-y/);
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

  it('gives the frozen first column a distinct surface color', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const rowHeadingRule = styles.match(/\.workspace-row-heading\s*\{([^}]*)\}/)?.[1];
    const dataCellRule = styles.match(/(?:^|\n)\.workspace-table td\s*\{([^}]*)\}/)?.[1];

    expect(rowHeadingRule).toMatch(/background:\s*var\(--cream\)/);
    expect(dataCellRule).toMatch(/background:\s*var\(--white\)/);
  });

  it('keeps table cells visually dense without removing their clickable area', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const tableCellRule = styles.match(/\.workspace-table th, \.workspace-table td\s*\{([^}]*)\}/)?.[1];
    const rowHeadingRule = styles.match(/\.workspace-row-heading\s*\{([^}]*)\}/)?.[1];

    expect(tableCellRule).toMatch(/padding:\s*2px 3px/);
    expect(rowHeadingRule).toMatch(/padding:\s*2px 3px/);
  });

  it('overlays every second-row toolbar without changing the table position', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const toolbarLayerRule = styles.match(/\.workspace-toolbar-layer\s*\{([^}]*)\}/)?.[1];
    const editbarRule = styles.match(/\.workspace-editbar\s*\{([^}]*)\}/)?.[1];
    const filterbarRule = styles.match(/\.workspace-filterbar\s*\{([^}]*)\}/)?.[1];
    const stackedFilterbarRule = styles.match(/\.workspace-filterbar\.has-bulk-toolbar\s*\{([^}]*)\}/)?.[1];
    const tableHeaderOffsetVariableRule = styles.match(/\.workspace-toolbar-layer \.workspace-table\s*\{([^}]*)\}/)?.[1];
    const tableHeaderOffsetRule = styles.match(/\.workspace-toolbar-layer \.workspace-table thead th\s*\{([^}]*)\}/)?.[1];

    expect(toolbarLayerRule).toMatch(/position:\s*relative/);
    expect(toolbarLayerRule).toMatch(/flex:\s*1/);
    expect(editbarRule).toMatch(/position:\s*absolute/);
    expect(editbarRule).toMatch(/top:\s*0/);
    expect(editbarRule).toMatch(/left:\s*0/);
    expect(editbarRule).toMatch(/right:\s*0/);
    expect(filterbarRule).toMatch(/position:\s*absolute/);
    expect(filterbarRule).toMatch(/top:\s*0/);
    expect(stackedFilterbarRule).toMatch(/top:\s*var\(--workspace-toolbar-row-height\)/);
    expect(tableHeaderOffsetVariableRule).toMatch(/--workspace-table-header-offset:\s*calc\(var\(--workspace-toolbar-row-height\) \* var\(--workspace-toolbar-row-count\)\)/);
    expect(tableHeaderOffsetRule).toMatch(/top:\s*0/);
    expect(tableHeaderOffsetRule).toMatch(/transform:\s*translate3d\(0,\s*var\(--workspace-table-header-offset,\s*0px\),\s*0\)/);
  });

  it('anchors workspace toasts to the app bar instead of the first table row', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const noticeRule = styles.match(/\.workspace-appbar-notice\s*\{([^}]*)\}/)?.[1];

    expect(noticeRule).toMatch(/top:\s*50%/);
    expect(noticeRule).toMatch(/pointer-events:\s*none/);
    expect(noticeRule).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
  });

  it('keeps the Google Drive action and automatic-backup toggle on one compact drawer row', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const footerRule = styles.match(/\.workspace-drawer-footer\s*\{([^}]*)\}/)?.[1];
    const driveButtonRule = styles.match(/\.workspace-drive-status-card\s*\{([^}]*)\}/)?.[1];
    const autoBackupRule = styles.match(/\.workspace-auto-backup-toggle\s*\{([^}]*)\}/)?.[1];
    const detailRule = styles.match(/\.workspace-drive-status-card span:last-child\s*\{([^}]*)\}/)?.[1];

    expect(footerRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
    expect(driveButtonRule).toMatch(/border:\s*1px solid var\(--green\)/);
    expect(autoBackupRule).toMatch(/white-space:\s*nowrap/);
    expect(detailRule).toMatch(/display:\s*none/);
  });

  it('adds mobile-only bottom scroll room without changing table cell dimensions', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const mobileStyles = styles.match(/@media \(max-width: 820px\)\s*\{([\s\S]*?)\n\}/)?.[1];
    const bottomSpacerRule = mobileStyles?.match(/\.workspace-table-viewport::after\s*\{([^}]*)\}/)?.[1];

    expect(bottomSpacerRule).toMatch(/display:\s*block/);
    expect(bottomSpacerRule).toMatch(/height:\s*max\(32px,\s*calc\(env\(safe-area-inset-bottom,\s*0px\) \+ 14px\)\)/);
    expect(bottomSpacerRule).toMatch(/pointer-events:\s*none/);
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

  it('drives table rebound from one shared frame clock instead of per-cell transitions', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const bounceTransitionRule = styles.match(/\.workspace-table\.is-bounce-settling[^\n]*\{([^}]*)\}/)?.[1];

    expect(bounceTransitionRule).toBeUndefined();
  });

  it('centers value editors independently from table text scaling', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const valueOverlayRule = styles.match(/\.workspace-value-dialog-overlay\s*\{([^}]*)\}/)?.[1];
    const valueInputRule = styles.match(/\.workspace-value-dialog \.workspace-value-input\s*\{([^}]*)\}/)?.[1];
    const numberInputShellRule = styles.match(/\.workspace-number-input-shell\s*\{([^}]*)\}/)?.[1];
    const appbarTitleRule = styles.match(/\.workspace-appbar-title span\s*\{([^}]*)\}/)?.[1];
    const overlayRule = styles.match(/\.workspace-overlay\s*\{([^}]*)\}/)?.[1];
    const dialogRule = styles.match(/\.workspace-dialog\s*\{([^}]*)\}/)?.[1];
    const editorHeadingRule = styles.match(/\.workspace-dialog-editor \.workspace-dialog-heading\s*\{([^}]*)\}/)?.[1];
    const selectionDialogRule = styles.match(/\.workspace-selection-dialog\s*\{([^}]*)\}/)?.[1];
    const selectionListContainerRule = styles.match(/\.workspace-selection-list\s*\{([^}]*)\}/)?.[1];
    const selectionFooterRule = styles.match(/\.workspace-selection-footer\s*\{([^}]*)\}/)?.[1];
    const selectionListRule = styles.match(/\.workspace-selection-option\s*\{([^}]*)\}/)?.[1];
    const selectionIndicatorRule = styles.match(/\.workspace-selection-option-indicator\s*\{([^}]*)\}/)?.[1];
    const contextActiveRule = styles.match(/\.workspace-table \.workspace-context-active\s*\{([^}]*)\}/)?.[1];
    const lineLimitRule = styles.match(/\.workspace-overflow-line-limited \.workspace-cell-value\s*\{([^}]*)\}/)?.[1];
    const multiEllipsisRule = styles.match(/\.workspace-overflow-ellipsis \.workspace-multi-chip-list\s*\{([^}]*)\}/)?.[1];
    const dragSurfaceRule = styles.match(/\.workspace-table-viewport, \.workspace-table-viewport \*, \.workspace-tree, \.workspace-tree \*\s*\{([^}]*)\}/)?.[1];
    const editableSurfaceRule = styles.match(/\.workspace-dialog input, \.workspace-dialog textarea, \.workspace-dialog select, \.workspace-dialog \[contenteditable="true"\]\s*\{([^}]*)\}/)?.[1];

    expect(valueOverlayRule).toMatch(/place-items:\s*center/);
    expect(valueInputRule).toMatch(/font-size:\s*28px/);
    expect(valueInputRule).not.toContain('--workspace-text-scale');
    expect(numberInputShellRule).toMatch(/border:\s*1px solid/);
    expect(numberInputShellRule).toMatch(/background:\s*rgba\(/);
    expect(appbarTitleRule).toMatch(/font-size:\s*24px/);
    expect(appbarTitleRule).toMatch(/line-height:\s*1\.2/);
    expect(overlayRule).toMatch(/font-size:\s*16px/);
    expect(overlayRule).toMatch(/--workspace-text-scale:\s*1/);

    const filterRule = styles.match(/\.workspace-header-filter\s*\{([^}]*)\}/)?.[1];
    const filterbarRule = styles.match(/\.workspace-filterbar\s*\{([^}]*)\}/)?.[1];
    const filterbarTrackRule = styles.match(/\.workspace-filterbar-scroll\s*\{([^}]*)\}/)?.[1];
    const filterbarButtonRule = styles.match(/\.workspace-filterbar-button\s*\{([^}]*)\}/)?.[1];
    expect(dialogRule).toMatch(/font-size:\s*16px/);
    expect(dialogRule).toMatch(/--workspace-text-scale:\s*1/);
    expect(editorHeadingRule).toMatch(/display:\s*none/);
    expect(selectionDialogRule).toMatch(/background:\s*rgba\(255,253,248,\.72\)/);
    expect(selectionDialogRule).toMatch(/width:\s*min\(430px,\s*50vw\)/);
    expect(selectionDialogRule).toMatch(/height:\s*auto/);
    expect(selectionDialogRule).toMatch(/margin-top:\s*clamp\(10px,\s*4dvh,\s*28px\)/);
    expect(selectionDialogRule).not.toMatch(/backdrop-filter/);
    expect(selectionListContainerRule).toMatch(/flex:\s*0 1 auto/);
    expect(selectionListContainerRule).toMatch(/max-height:\s*min\(calc\(75dvh - 80px\)/);
    expect(selectionFooterRule).toMatch(/justify-content:\s*flex-start/);
    expect(selectionFooterRule).toMatch(/border-top:/);
    expect(styles).toMatch(/\.workspace-datetime-dialog\s*\{[^}]*width:\s*min\(340px,\s*75vw\)/);
    expect(selectionListRule).toMatch(/justify-content:\s*flex-start/);
    expect(selectionListRule).toMatch(/font-size:\s*16px/);
    expect(selectionIndicatorRule).toMatch(/width:\s*17px/);
    expect(contextActiveRule).toMatch(/background:\s*#fff4d6/);
    expect(lineLimitRule).toMatch(/-webkit-line-clamp:\s*var\(--workspace-line-limit\)/);
    expect(multiEllipsisRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(dragSurfaceRule).toMatch(/user-select:\s*none/);
    expect(dragSurfaceRule).toMatch(/-webkit-touch-callout:\s*none/);
    expect(editableSurfaceRule).toMatch(/user-select:\s*text/);
    expect(filterRule).toMatch(/position:\s*absolute/);
    expect(filterRule).toMatch(/min-height:\s*20px/);
    expect(filterRule).toMatch(/opacity:\s*\.42/);
    expect(filterRule).not.toMatch(/flex:\s*0 0/);
    expect(filterbarRule).toMatch(/overflow-x:\s*auto/);
    expect(filterbarTrackRule).toMatch(/display:\s*grid/);
    expect(filterbarTrackRule).toMatch(/touch-action:\s*pan-x/);
    expect(filterbarButtonRule).toMatch(/width:\s*100%/);
    expect(filterbarButtonRule).toMatch(/border-right:\s*1px solid var\(--line\)/);
    const frozenFilterbarRule = styles.match(/\.workspace-filterbar-button\.is-frozen, \.workspace-filterbar-spacer\.is-frozen\s*\{([^}]*)\}/)?.[1];
    expect(frozenFilterbarRule).toMatch(/position:\s*sticky/);
    expect(frozenFilterbarRule).toMatch(/left:\s*0/);
    expect(styles).toMatch(/\.workspace-paste-button\s*\{\s*display:\s*none;\s*\}/);
    expect(styles).not.toContain('.workspace-filterbar-count');
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

  it('keeps the main website as the PWA entry while offering a workspace shortcut', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { start_url?: string; scope?: string; shortcuts?: Array<{ url?: string }> };
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.shortcuts?.some((shortcut) => shortcut.url === '/?pwa-entry=home')).toBe(true);
    expect(manifest.shortcuts?.some((shortcut) => shortcut.url === '/attributes')).toBe(true);
    expect(manifest.shortcuts?.some((shortcut) => shortcut.url === '/workspace')).toBe(true);
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

  it('centers stepper numbers and reserves wider controls for three-digit values', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const stepRule = styles.match(/\.workspace-number-editor\[data-mode="step"\]\s*\{([^}]*)\}/)?.[1];
    const stepOperationRule = styles.match(/\.workspace-number-editor\[data-mode="step"\] \.workspace-number-operation\s*\{([^}]*)\}/)?.[1];
    const stepInputRule = styles.match(/\.workspace-number-editor\[data-mode="step"\] \.workspace-value-input\s*\{([^}]*)\}/)?.[1];

    expect(stepRule).toMatch(/grid-template-columns:\s*50px minmax\(0, 10ch\) 50px/);
    expect(stepOperationRule).toMatch(/width:\s*48px/);
    expect(stepOperationRule).toMatch(/min-height:\s*46px/);
    expect(stepInputRule).toMatch(/text-align:\s*center/);
  });

  it('restricts horizontal overscroll navigation on root and disables rubber-banding in standalone PWA', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const htmlRule = styles.match(/(?:^|\n)html\s*\{([^}]*)\}/)?.[1];
    const bodyRule = styles.match(/(?:^|\n)body\s*\{([^}]*)\}/)?.[1];
    const standaloneRule = styles.match(/html\[data-standalone='true'\],\s*html\[data-standalone='true'\] body\s*\{([^}]*)\}/)?.[1];
    const workspacePageRule = styles.match(/\.workspace-page\s*\{([^}]*)\}/)?.[1];

    expect(htmlRule).toMatch(/overscroll-behavior-x:\s*none/);
    expect(bodyRule).toMatch(/overscroll-behavior-x:\s*none/);
    expect(standaloneRule).toMatch(/overscroll-behavior:\s*none/);
    expect(workspacePageRule).toMatch(/overscroll-behavior:\s*none/);
  });

  it('uses only the real top safe area for standalone app bars', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const standaloneAppbarRule = styles.match(/html\[data-standalone='true'\] \.site-header,\s*html\[data-standalone='true'\] \.workspace-appbar\s*\{([^}]*)\}/)?.[1];

    expect(standaloneAppbarRule).toMatch(/padding-top:\s*env\(safe-area-inset-top,\s*0px\)/);
    expect(standaloneAppbarRule).not.toMatch(/max\(44px/);
  });

  it('keeps bottom navigation in the Workspace layout, inside the iOS safe area, and removes it for a virtual keyboard', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    const workspacePageRule = styles.match(/\.workspace-page\s*\{([^}]*)\}/)?.[1];
    const navigationRule = styles.match(/\.workspace-bottom-navigation\s*\{([^}]*)\}/)?.[1];
    const pageSource = readFileSync('src/pages/WorkspacePage.tsx', 'utf8');

    expect(workspacePageRule).toMatch(/height:\s*100dvh/);
    expect(navigationRule).toMatch(/flex:\s*0 0 auto/);
    expect(navigationRule).toMatch(/env\(safe-area-inset-bottom/);
    expect(navigationRule).not.toMatch(/position:\s*fixed/);
    expect(pageSource).toMatch(/!virtualKeyboardOpen && bottomNavigationItems\.length > 0/);
  });
});
