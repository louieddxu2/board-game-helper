import { describe, expect, it } from 'vitest';
import {
  advanceWorkspaceBackupProgress,
  workspaceBackupProgressCount,
  workspaceBackupProgressValue,
  type WorkspaceBackupPhase,
  type WorkspaceBackupProgress,
} from './backupProgress';

const progress = (phase: WorkspaceBackupPhase, completedTables = 0, totalTables = 2): WorkspaceBackupProgress => ({
  phase, completedTables, totalTables,
});

describe('workspace backup overall progress', () => {
  it.each([
    ['preparing', 0], ['checking-remote', 3], ['reading-directory', 8], ['preparing-cloud', 12], ['preparing-folders', 12],
    ['saving-index', 85], ['verifying-index', 90], ['confirming', 95], ['cleaning-history', 97], ['saving-receipt', 99], ['complete', 100],
  ] as const)('maps %s to the overall progress stage', (phase, expected) => {
    expect(workspaceBackupProgressValue(progress(phase))).toBe(expected);
    expect(workspaceBackupProgressCount(progress(phase))).toBe(`${expected}%`);
  });

  it.each([
    ['reading-table', 0, 15], ['creating-file', 0, 26], ['uploading-table', 0, 38],
    ['table-uploaded', 1, 50], ['reusing-table', 1, 50],
  ] as const)('maps %s to a table substep without showing 0/0', (phase, completedTables, expected) => {
    const value = progress(phase, completedTables);
    expect(workspaceBackupProgressValue(value)).toBeCloseTo(expected);
    expect(workspaceBackupProgressCount(value)).toBe(`${Math.round(expected)}% · 已上傳 ${completedTables} / 2 張表格`);
  });

  it('keeps an empty table count on an overall stage', () => {
    const empty = { phase: 'reading-table', completedTables: 0, totalTables: 0 } as WorkspaceBackupProgress;
    expect(workspaceBackupProgressValue(empty)).toBe(15);
    expect(workspaceBackupProgressCount(empty)).toBe('15%');
    expect(workspaceBackupProgressValue({ phase: 'reading-table' })).toBe(15);
    expect(workspaceBackupProgressCount({ phase: 'reading-table' })).toBe('15%');
  });

  it('advances one operation monotonically and reserves 100% for complete', () => {
    const first = advanceWorkspaceBackupProgress(undefined, progress('preparing'));
    const uploading = advanceWorkspaceBackupProgress(first, progress('uploading-table', 0));
    const finalizing = advanceWorkspaceBackupProgress(uploading, progress('confirming', 2));
    const regressed = advanceWorkspaceBackupProgress(finalizing, progress('reading-table', 0));
    const complete = advanceWorkspaceBackupProgress(regressed, progress('complete', 2));

    expect(first.overallPercent).toBe(0);
    expect(uploading.overallPercent).toBe(38);
    expect(finalizing.overallPercent).toBe(95);
    expect(regressed.overallPercent).toBe(95);
    expect(complete.overallPercent).toBe(100);
    expect(workspaceBackupProgressValue({ phase: 'confirming', overallPercent: 100 })).toBe(99);
  });
});
