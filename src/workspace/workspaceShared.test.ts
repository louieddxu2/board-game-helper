import { describe, expect, it } from 'vitest';
import { calculateWorkspaceTableLayout, measureWorkspaceText, workspaceCellPadding, workspaceMinColumnWidth } from './workspaceShared';

describe('workspace text measurements', () => {
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
});
