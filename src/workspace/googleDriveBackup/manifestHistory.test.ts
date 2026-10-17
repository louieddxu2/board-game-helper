import { describe, expect, it } from 'vitest';
import { adoptedDriveLegacyBaseline, driveLegacyBaselineForBackup, findDriveManifestHeads, needsDriveLegacyHistory } from './manifestHistory';
import type { DriveFile } from './types';

const time = (second: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, second)).toISOString();
const legacy = (id: string, second: number): DriveFile => ({
  id, name: 'manifest.xlsx', createdTime: time(second), modifiedTime: time(second),
  appProperties: { backedUpAt: String(second) },
});
const versioned = (id: string, parents: string[], second: number): DriveFile => ({
  ...legacy(id, second), appProperties: { backedUpAt: String(second), parentManifestIds: JSON.stringify(parents) },
});
const withBaseline = (file: DriveFile, id: string, second: number): DriveFile => ({
  ...file, appProperties: { ...file.appProperties, adoptedLegacyId: id, adoptedLegacyTime: time(second) },
});

describe('Drive manifest history across legacy cleanup', () => {
  it('recovers adopted ancestry through trash without adopting the trash modification time', () => {
    const old = legacy('old', 1);
    const deleted = { ...legacy('adopted', 2), modifiedTime: time(9) };
    const head = versioned('head', ['deleted-child'], 5);
    const history = [deleted, versioned('deleted-child', ['adopted'], 3)];
    const files = [old, head];

    expect(needsDriveLegacyHistory(files)).toBe(true);
    const baseline = adoptedDriveLegacyBaseline(files, history);
    expect(baseline).toEqual({ id: 'adopted', time: Date.parse(time(2)) });
    expect(findDriveManifestHeads(files, baseline).map(file => file.id)).toEqual(['head']);
  });

  it('keeps a genuine legacy write between the adopted snapshot and versioned publication as a conflict', () => {
    const deleted = { ...legacy('adopted', 2), modifiedTime: time(9) };
    const head = versioned('head', ['adopted'], 5);
    const files = [head, legacy('concurrent-legacy', 3)];
    const baseline = adoptedDriveLegacyBaseline(files, [deleted]);

    expect(findDriveManifestHeads(files, baseline).map(file => file.id)).toEqual(['head', 'concurrent-legacy']);
  });

  it('cannot use unrelated trashed indexes to dismiss a legacy branch', () => {
    const files = [versioned('head', ['missing'], 5), legacy('possible-branch', 1)];
    const baseline = adoptedDriveLegacyBaseline(files, [legacy('unrelated', 4)]);

    expect(baseline).toBeUndefined();
    expect(findDriveManifestHeads(files, baseline)).toHaveLength(2);
  });

  it('preserves adoption after ancestors are purged while still detecting an in-place legacy edit', () => {
    const head = withBaseline(versioned('head', ['purged-parent'], 5), 'adopted', 2);
    const old = legacy('old', 1);
    expect(findDriveManifestHeads([head, old]).map(file => file.id)).toEqual(['head']);
    expect(needsDriveLegacyHistory([head, old])).toBe(false);

    const changed = { ...legacy('adopted', 2), modifiedTime: time(3) };
    const oldChild = versioned('old-child', ['adopted'], 4);
    const current = { ...head, appProperties: { ...head.appProperties, parentManifestIds: '["old-child"]' } };
    expect(findDriveManifestHeads([current, oldChild, changed]).map(file => file.id)).toEqual(['head', 'adopted']);
  });

  it('cannot infer an old snapshot adopted a later in-place edit of its legacy parent', () => {
    const head = versioned('head', ['adopted'], 5);
    const changed = { ...legacy('adopted', 2), modifiedTime: time(3) };
    expect(findDriveManifestHeads([head, changed]).map(file => file.id)).toEqual(['head', 'adopted']);
  });

  it.each(['same-time', 'missing-time'])('keeps ambiguous %s legacy metadata as a conflict', scenario => {
    const head = withBaseline(versioned('head', [], 5), 'adopted', 2);
    const unknown = legacy('different-id', 2);
    if (scenario === 'missing-time') { delete unknown.createdTime; delete unknown.modifiedTime; }
    expect(findDriveManifestHeads([head, unknown])).toHaveLength(2);
  });

  it('does not merge competing versioned heads with a shared legacy baseline', () => {
    const first = withBaseline(versioned('first', ['shared-parent'], 4), 'adopted', 2);
    const second = withBaseline(versioned('second', ['shared-parent'], 5), 'adopted', 2);
    expect(findDriveManifestHeads([first, second, legacy('old', 1)]).map(file => file.id)).toEqual(['second', 'first']);
  });

  it('records a manually adopted newer legacy snapshot for subsequent backups', () => {
    const baseline = driveLegacyBaselineForBackup([versioned('head', [], 5), legacy('new-legacy', 3)], { id: 'old-legacy', time: Date.parse(time(2)) });
    expect(baseline).toEqual({ id: 'new-legacy', time: Date.parse(time(3)) });
  });
});
