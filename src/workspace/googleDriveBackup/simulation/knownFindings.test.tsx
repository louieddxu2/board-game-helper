import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Operation } from './operations';
import { createWorld, InvariantViolation, type World, type WorldOptions } from './world';

vi.mock('../index', async importOriginal => ({
  ...await importOriginal<typeof import('../index')>(),
  createGoogleIdentityTokenProvider: () => ({ isAuthorized: true, signIn: async () => 'simulated-token', signOut: async () => undefined, getAccessToken: async () => 'simulated-token' }),
}));

/** Run a history without the closing recovery phase; report the first broken invariant. */
const firstViolation = async (operations: Operation[], options: WorldOptions, inspect?: (world: World) => void) => {
  const world = await createWorld(options);
  try {
    for (const operation of operations) await world.run(operation);
    return undefined;
  } catch (cause) {
    if (!(cause instanceof InvariantViolation)) throw cause;
    return cause.code;
  } finally { inspect?.(world); world.dispose(); }
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// Each test states what the code does TODAY. When a cause is fixed its test fails: change the
// expectation to `toBeUndefined()` and drop the code from KNOWN_FINDINGS in backupSimulation.test.tsx.
describe('backup simulator: confirmed findings', () => {
  test('a session that outlives its trashed backup folder reports success for a backup inside the trash', async () => {
    const code = await firstViolation([
      { kind: 'connect', device: 0 },
      { kind: 'drive-trash', target: 'snapshot-root' },
      { kind: 'backup', device: 0, force: false },
    ], { devices: 1 });
    expect(code).toBe('BACKUP_PUBLISHED_INTO_TRASH');
  });

  test('two devices setting up at the same moment create separate backup folders', async () => {
    let roots = 0;
    const code = await firstViolation([
      { kind: 'backup', device: 0, force: false, externalAt: 3 },
    ], { devices: 1, freshDrive: true }, world => {
      roots = world.drive.fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'root').length;
    });
    expect(code).toBe('UPLOAD_OVER_UNSEEN_VERSION');
    expect(roots).toBe(2);
  });

  test('an interrupted upload leaves its table copies in Drive with nothing to remove them', async () => {
    let orphans = 0;
    const code = await firstViolation([
      { kind: 'connect', device: 0 },
      { kind: 'backup', device: 0, force: false, fault: { at: 'manifest', mode: 'drop' } },
      ...Array.from({ length: 5 }, (): Operation[] => [{ kind: 'edit', device: 0, edit: 'cell', pick: 0 }, { kind: 'backup', device: 0, force: false }]).flat(),
      { kind: 'wait', device: 0, minutes: 6 },
    ], { devices: 1 }, world => { orphans = world.drive.orphanSnapshotFolders().length; });
    expect(code).toBeUndefined();
    expect(orphans).toBe(1);
  });
});

describe('backup simulator: the safeguards it relies on', () => {
  test('a lost reply to the publishing request does not block the device with its own backup', async () => {
    let published = -1;
    const code = await firstViolation([
      { kind: 'connect', device: 0 },
      { kind: 'backup', device: 0, force: false },
      { kind: 'edit', device: 0, edit: 'cell', pick: 0 },
      // Drive stores the index, but the browser never learns the upload succeeded.
      { kind: 'backup', device: 0, force: false, fault: { at: 'manifest', mode: 'lost-response' } },
      // A later attempt that fails outright must not disown the unconfirmed upload either.
      { kind: 'backup', device: 0, force: false, fault: { at: 'manifest', mode: 'drop' } },
      { kind: 'reload', device: 0 },
      { kind: 'connect', device: 0 },
      { kind: 'backup', device: 0, force: false },
    ], { devices: 1 }, world => { published = world.stats.snapshotsPublished; });
    expect(code).toBeUndefined();
    expect(published).toBe(3);
  });


  test('a device whose site data was cleared never uploads until the user decides', async () => {
    let published = -1;
    const code = await firstViolation([
      { kind: 'connect', device: 0 },
      { kind: 'backup', device: 0, force: false },
      { kind: 'wipe', device: 0, keepLocalStorage: true },
      { kind: 'connect', device: 0 },
      { kind: 'backup', device: 0, force: false },
      { kind: 'backup', device: 0, force: true },
      { kind: 'edit', device: 0, edit: 'add-table', pick: 0 },
      { kind: 'backup', device: 0, force: false },
      { kind: 'wait', device: 0, minutes: 65 },
    ], { devices: 1 }, world => { published = world.stats.snapshotsPublished; });
    expect(code).toBeUndefined();
    expect(published).toBe(1);
  });
});
