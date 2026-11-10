import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { describeOperation, generateOperations, simplifyOperation, type Operation } from './operations';
import { createRandom, shrinkSequence } from './random';
import { createWorld, InvariantViolation, type WorldOptions, type WorldStats } from './world';

vi.mock('../index', async importOriginal => ({
  ...await importOriginal<typeof import('../index')>(),
  createGoogleIdentityTokenProvider: () => ({ isAuthorized: true, signIn: async () => 'simulated-token', signOut: async () => undefined, getAccessToken: async () => 'simulated-token' }),
}));

const SEEDS = Number(process.env.BACKUP_SIM_SEEDS ?? 30);
const FIRST_SEED = Number(process.env.BACKUP_SIM_SEED ?? 1);
const LENGTH = Number(process.env.BACKUP_SIM_LENGTH ?? 40);

// Confirmed findings, each pinned by a minimal history in knownFindings.test.tsx. Remove a code here
// once its cause is fixed. BACKUP_SIM_STRICT=1 makes the search report them again.
const KNOWN_FINDINGS = ['BACKUP_PUBLISHED_INTO_TRASH'];
const TOLERATED = process.env.BACKUP_SIM_STRICT === '1' ? [] : KNOWN_FINDINGS;
const DEVICES = Number(process.env.BACKUP_SIM_DEVICES ?? 2);
const optionsFor = (seed: number): WorldOptions => ({ devices: DEVICES, legacy: seed % 3 === 0, tolerate: TOLERATED });

const execute = async (operations: readonly Operation[], options: WorldOptions) => {
  const world = await createWorld(options);
  try {
    for (const operation of operations) await world.run(operation);
    return { ...(await world.finish()), violation: undefined };
  } catch (cause) {
    if (!(cause instanceof InvariantViolation)) throw cause;
    return { stats: world.stats, observations: world.observations, violation: cause };
  } finally { world.dispose(); }
};

const report = async (seed: number, operations: Operation[], options: WorldOptions, violation: InvariantViolation) => {
  const minimal = await shrinkSequence(operations, async candidate => (await execute(candidate, options)).violation?.code === violation.code, simplifyOperation);
  const final = (await execute(minimal, options)).violation ?? violation;
  return [
    `備份模擬在 seed ${seed} 違反 ${final.code}`,
    final.detail,
    `最短重現步驟（原 ${operations.length} 步 → ${minimal.length} 步${options.legacy ? '；Drive 上原本有舊版 v2 備份' : ''}）：`,
    ...minimal.map((operation, index) => `  ${index + 1}. ${describeOperation(operation)}`),
    '  （最後：網路恢復正常，每台裝置重新連結、備份、重新整理、等待自動備份）',
    `重跑：BACKUP_SIM_SEED=${seed} BACKUP_SIM_SEEDS=1 npx vitest run src/workspace/googleDriveBackup/simulation`,
    `步驟 JSON：${JSON.stringify(minimal)}`,
  ].join('\n');
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const REPLAY = process.env.BACKUP_SIM_STEPS;

describe('Workspace Drive backup under random faults', () => {
  // Paste the "步驟 JSON" of a reported failure to replay exactly that history.
  test.runIf(REPLAY)('replays the steps in BACKUP_SIM_STEPS', async () => {
    const operations = JSON.parse(REPLAY!) as Operation[];
    const options: WorldOptions = { devices: 2, legacy: process.env.BACKUP_SIM_LEGACY === '1', freshDrive: process.env.BACKUP_SIM_FRESH === '1', tolerate: TOLERATED };
    const { violation } = await execute(operations, options);
    if (violation) expect.fail([`${violation.code}: ${violation.detail}`, ...operations.map((operation, index) => `  ${index + 1}. ${describeOperation(operation)}`)].join('\n'));
  });

  test.skipIf(REPLAY)(`never loses or misreports user data across ${SEEDS} random histories`, async () => {
    const total: Partial<WorldStats> = {};
    for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed += 1) {
      const options = optionsFor(seed);
      const operations = generateOperations(createRandom(seed), LENGTH, options.devices ?? 2);
      const result = await execute(operations, options);
      if (result.violation) expect.fail(await report(seed, operations, options, result.violation));
      for (const [key, value] of Object.entries(result.stats) as [keyof WorldStats, number][]) total[key] = (total[key] ?? 0) + value;
    }
    process.stderr.write(`[backup-simulation] ${JSON.stringify(total)}\n`);
  }, 600_000);
});
