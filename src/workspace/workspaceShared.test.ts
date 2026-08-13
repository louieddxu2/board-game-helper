import { describe, expect, it } from 'vitest';
import { calculateWorkspaceTableLayout, ensureWorkspaceCellVisible, matchesWorkspaceFilter, measureWorkspaceText, searchableWorkspaceCellValue, workspaceCellPadding, workspaceMinColumnWidth } from './workspaceShared';

describe('workspace text measurements', () => {
  it('uses only compact horizontal padding in width calculations', () => {
    expect(workspaceCellPadding).toBe(8);
  });

  it('searches only the visible date when time display is disabled', () => {
    const value = '2026-08-12T12:14:00.000Z';
    expect(searchableWorkspaceCellValue(value, 'datetime', true)).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(searchableWorkspaceCellValue(value, 'datetime', true)).not.toContain(':');
  });

  it('does not turn empty content into a scalable character width', () => {
    expect(measureWorkspaceText('', 20, 600)).toBe(0);
    expect(measureWorkspaceText('   \n  ', 20, 600)).toBe(0);

    const widthAt = (scale: number) => Math.max(workspaceMinColumnWidth, measureWorkspaceText('', 20, 600) * scale + workspaceCellPadding);
    expect([widthAt(1), widthAt(1.2), widthAt(2.5)]).toEqual([40, 40, 40]);
    const emptyLayouts = [1, 1.2, 2.5].map((scale) => calculateWorkspaceTableLayout([0, 0, 0, 0], scale, 1000));
    expect(emptyLayouts.map((layout) => layout.tableWidth)).toEqual([1000, 1000, 1000]);
    expect(emptyLayouts.map((layout) => layout.columnWidths)).toEqual([emptyLayouts[0].columnWidths, emptyLayouts[0].columnWidths, emptyLayouts[0].columnWidths]);
  });

  it('still measures visible content for text-driven sizing', () => {
    expect(measureWorkspaceText('文字', 20, 600)).toBeGreaterThan(0);
  });

  it('changes only the content column when one expandable column has text', () => {
    const normal = calculateWorkspaceTableLayout([0, 120, 0, 0], 1, 1000);
    const zoomed = calculateWorkspaceTableLayout([0, 120, 0, 0], 1.5, 1000);

    expect(zoomed.columnWidths[1]).toBeGreaterThan(normal.columnWidths[1]);
    expect(zoomed.columnWidths[0]).toBeCloseTo(normal.columnWidths[0], 8);
    expect(zoomed.columnWidths[2]).toBeCloseTo(normal.columnWidths[2], 8);
    expect(zoomed.columnWidths[3]).toBeCloseTo(normal.columnWidths[3], 8);
  });

  it('does not redistribute overflow space into empty columns after zooming', () => {
    const normal = calculateWorkspaceTableLayout([0, 250, 0, 0], 1, 400);
    const zoomed = calculateWorkspaceTableLayout([0, 250, 0, 0], 2.5, 400);

    expect(zoomed.tableWidth).toBeGreaterThan(400);
    expect(zoomed.columnWidths[1]).toBeGreaterThan(normal.columnWidths[1]);
    expect(zoomed.columnWidths[0]).toBeCloseTo(normal.columnWidths[0], 8);
    expect(zoomed.columnWidths[2]).toBeCloseTo(normal.columnWidths[2], 8);
    expect(zoomed.columnWidths[3]).toBeCloseTo(normal.columnWidths[3], 8);
  });

  it('keeps an active cell above the visual keyboard and below the sticky header', () => {
    const viewport = document.createElement('div');
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headCell = document.createElement('th');
    const body = document.createElement('tbody');
    const heading = document.createElement('th');
    const cell = document.createElement('td');
    heading.className = 'workspace-row-heading';
    headRow.append(headCell);
    head.append(headRow);
    body.append(heading, cell);
    table.append(head, body);
    viewport.append(table);
    document.body.append(viewport);
    Object.defineProperty(viewport, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 780, left: 0, right: 390, width: 390, height: 732 }) });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 732 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 390 });
    Object.defineProperty(head, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 100, left: 0, right: 390, width: 390, height: 52 }) });
    Object.defineProperty(headCell, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 100, left: 0, right: 390, width: 390, height: 52 }) });
    Object.defineProperty(heading, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 100, bottom: 150, left: 0, right: 84, width: 84, height: 50 }) });
    Object.defineProperty(cell, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 520 - viewport.scrollTop, bottom: 560 - viewport.scrollTop, left: 120, right: 240, width: 120, height: 40 }) });
    const previousVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { offsetTop: 0, offsetLeft: 0, width: 390, height: 300 } });

    try {
      ensureWorkspaceCellVisible(cell, viewport);
      expect(viewport.scrollTop).toBe(268);
      ensureWorkspaceCellVisible(cell, viewport);
      expect(viewport.scrollTop).toBe(268);
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
      viewport.remove();
    }
  });

  it('keeps a body cell below the frozen header when the thead itself has scrolled away', () => {
    const viewport = document.createElement('div');
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headCell = document.createElement('th');
    const body = document.createElement('tbody');
    const heading = document.createElement('th');
    const cell = document.createElement('td');
    headRow.append(headCell);
    head.append(headRow);
    heading.className = 'workspace-row-heading';
    body.append(heading, cell);
    table.append(head, body);
    viewport.append(table);
    document.body.append(viewport);
    Object.defineProperty(viewport, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 780, left: 0, right: 390, width: 390, height: 732 }) });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 732 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1600 });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 390 });
    Object.defineProperty(head, 'getBoundingClientRect', { configurable: true, value: () => ({ top: -500, bottom: -448, left: 0, right: 390, width: 390, height: 52 }) });
    Object.defineProperty(headCell, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 100, left: 0, right: 390, width: 390, height: 52 }) });
    Object.defineProperty(heading, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 100, bottom: 150, left: 0, right: 84, width: 84, height: 50 }) });
    Object.defineProperty(cell, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 80, bottom: 120, left: 120, right: 240, width: 120, height: 40 }) });
    const previousVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { offsetTop: 0, offsetLeft: 0, width: 390, height: 780 } });
    viewport.scrollTop = 500;

    try {
      ensureWorkspaceCellVisible(cell, viewport);
      expect(viewport.scrollTop).toBe(476);
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
      viewport.remove();
    }
  });

  it('does not scroll beyond the table content when the keyboard target is near the end', () => {
    const viewport = document.createElement('div');
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const body = document.createElement('tbody');
    const heading = document.createElement('th');
    const cell = document.createElement('td');
    heading.className = 'workspace-row-heading';
    body.append(heading, cell);
    table.append(head, body);
    viewport.append(table);
    document.body.append(viewport);
    Object.defineProperty(viewport, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 448, left: 0, right: 390, width: 390, height: 400 }) });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 600 });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 390 });
    Object.defineProperty(head, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 48, bottom: 100, left: 0, right: 390, width: 390, height: 52 }) });
    Object.defineProperty(heading, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 100, bottom: 150, left: 0, right: 84, width: 84, height: 50 }) });
    Object.defineProperty(cell, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 520 - viewport.scrollTop, bottom: 560 - viewport.scrollTop, left: 120, right: 240, width: 120, height: 40 }) });
    const previousVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { offsetTop: 0, offsetLeft: 0, width: 390, height: 300 } });

    try {
      ensureWorkspaceCellVisible(cell, viewport);
      expect(viewport.scrollTop).toBe(200);
      expect(viewport.scrollTop).toBeLessThanOrEqual(viewport.scrollHeight - viewport.clientHeight);
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
      viewport.remove();
    }
  });
});

describe('workspace date filters', () => {
  it('filters date-time values by selected year-month keys', () => {
    const state = { includedKeys: ['date-month:2024-02'], sort: null };

    expect(matchesWorkspaceFilter('2024-02-03T14:05+08:00', 'datetime', state)).toBe(true);
    expect(matchesWorkspaceFilter('2024-03-03T14:05+08:00', 'datetime', state)).toBe(false);
    expect(matchesWorkspaceFilter(null, 'datetime', state)).toBe(false);
  });

  it('filters date-time values with an inclusive date range', () => {
    const state = { includedKeys: null, sort: null, min: '2024-02-01', max: '2024-02-29' } as const;

    expect(matchesWorkspaceFilter('2024-02-01T00:00:00+08:00', 'datetime', state)).toBe(true);
    expect(matchesWorkspaceFilter('2024-02-29T23:59:59+08:00', 'datetime', state)).toBe(true);
    expect(matchesWorkspaceFilter('2024-03-01T00:00:00+08:00', 'datetime', state)).toBe(false);
    expect(matchesWorkspaceFilter(null, 'datetime', state)).toBe(false);
  });
});
