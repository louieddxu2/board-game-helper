import { describe, expect, it } from 'vitest';
import { measureWorkspaceText, workspaceCellPadding, workspaceMinColumnWidth } from './workspaceShared';

describe('workspace text measurements', () => {
  it('does not turn empty content into a scalable character width', () => {
    expect(measureWorkspaceText('', 20, 600)).toBe(0);
    expect(measureWorkspaceText('   \n  ', 20, 600)).toBe(0);

    const widthAt = (scale: number) => Math.max(workspaceMinColumnWidth, measureWorkspaceText('', 20, 600) * scale + workspaceCellPadding);
    expect([widthAt(1), widthAt(1.2), widthAt(2.5)]).toEqual([40, 40, 40]);
  });

  it('still measures visible content for text-driven sizing', () => {
    expect(measureWorkspaceText('文字', 20, 600)).toBeGreaterThan(0);
  });
});
