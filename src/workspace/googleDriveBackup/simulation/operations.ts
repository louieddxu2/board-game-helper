import type { Fault, FaultMode, FaultTarget } from './faultyDrive';
import type { Random } from './random';
import type { EditKind } from './workspaceModel';

/** What can go wrong around one user action. */
export interface Disturbance {
  /** One Drive request of this action fails. */
  fault?: Fault;
  /** The browser refuses localStorage writes (quota, private mode) during this action. */
  storageFull?: boolean;
  /** The user keeps typing while request N of this action is in flight. */
  editAt?: number;
  /** Another device publishes its own backup while request N of this action is in flight. */
  externalAt?: number;
}

export type Operation = Disturbance & (
  | { kind: 'edit'; device: number; edit: EditKind; pick: number }
  | { kind: 'connect'; device: number }
  | { kind: 'backup'; device: number; force: boolean }
  | { kind: 'wait'; device: number; minutes: number }
  | { kind: 'restore'; device: number; version: number; decision: 'replace' | 'cancel' }
  | { kind: 'reload'; device: number }
  | { kind: 'wipe'; device: number; keepLocalStorage: boolean }
  | { kind: 'auto'; device: number; enabled: boolean }
  | { kind: 'external' }
  | { kind: 'drive-trash'; target: 'newest-snapshot' | 'snapshot-root' }
);

const faultModes: FaultMode[] = ['drop', 'lost-response', 'http-500', 'http-403'];
const faultTargets: FaultTarget[] = ['lookup', 'folder', 'table', 'manifest', 'trash'];
const edits: readonly (readonly [number, EditKind])[] = [[6, 'cell'], [2, 'add-row'], [2, 'add-table'], [1, 'delete-table'], [2, 'rename-table']];

const disturbance = (random: Random, network: boolean, uploads: boolean): Disturbance => ({
  ...(network && random.chance(0.3) ? { fault: { at: random.chance(0.5) ? random.int(8) : random.pick(faultTargets), mode: random.pick(faultModes) } } : {}),
  ...(uploads && random.chance(0.08) ? { storageFull: true } : {}),
  ...(uploads && random.chance(0.12) ? { editAt: random.int(6) } : {}),
  ...(network && random.chance(0.1) ? { externalAt: random.int(6) } : {}),
});

export const generateOperations = (random: Random, length: number, devices: number): Operation[] => {
  // People work on one device for a while; long same-device runs reach the deeper states.
  let device = random.int(devices);
  return Array.from({ length }, (): Operation => {
    if (random.chance(0.25)) device = random.int(devices);
    return nextOperation(random, device);
  });
};

const nextOperation = (random: Random, device: number): Operation => {
  return random.weighted<() => Operation>([
    [22, () => ({ kind: 'edit', device, edit: random.weighted(edits), pick: random.int(1000) })],
    [14, () => ({ kind: 'connect', device, ...disturbance(random, true, false) })],
    [20, () => ({ kind: 'backup', device, force: random.chance(0.3), ...disturbance(random, true, true) })],
    [14, () => ({ kind: 'wait', device, minutes: random.pick([1, 6, 31, 65]), ...disturbance(random, true, true) })],
    [8, () => ({ kind: 'restore', device, version: random.int(6), decision: random.chance(0.7) ? 'replace' : 'cancel', ...disturbance(random, true, false) })],
    [8, () => ({ kind: 'reload', device })],
    [4, () => ({ kind: 'wipe', device, keepLocalStorage: random.chance(0.5) })],
    [5, () => ({ kind: 'auto', device, enabled: random.chance(0.5) })],
    [5, () => ({ kind: 'external' })],
    [2, () => ({ kind: 'drive-trash', target: random.chance(0.5) ? 'newest-snapshot' : 'snapshot-root' })],
  ])();
};

/** Strictly simpler variants of one step, tried after removal can no longer shrink a failure. */
export const simplifyOperation = (operation: Operation): Operation[] => {
  const simpler: Operation[] = [];
  for (const key of ['fault', 'storageFull', 'editAt', 'externalAt'] as const) {
    if (operation[key] === undefined) continue;
    const { [key]: _removed, ...rest } = operation;
    simpler.push(rest as Operation);
  }
  if (operation.fault && operation.fault.mode !== 'drop') simpler.push({ ...operation, fault: { ...operation.fault, mode: 'drop' } });
  if (operation.kind === 'wait' && operation.minutes !== 31) simpler.push({ ...operation, minutes: 31 });
  return simpler;
};

const deviceNames = ['手機', '平板', '筆電'];
export const deviceName = (index: number) => deviceNames[index] ?? `裝置${index + 1}`;

const faultText: Record<FaultMode, string> = {
  drop: '沒送到 Drive',
  'lost-response': '已被 Drive 執行但回應遺失',
  'http-500': '收到 HTTP 500',
  'http-403': '收到 HTTP 403（空間不足）',
};

const targetText: Record<Exclude<FaultTarget, number>, string> = {
  lookup: '查詢雲端最新版本的請求', folder: '建立備份資料夾的請求', table: '上傳表格的請求', manifest: '上傳索引（發布備份）的請求', trash: '清理舊備份的請求',
};

export const describeOperation = (operation: Operation): string => {
  const who = operation.kind === 'external' ? '另一台裝置' : operation.kind === 'drive-trash' ? '使用者在 Drive 網頁' : deviceName(operation.device);
  const action = (() => {
    switch (operation.kind) {
      case 'edit': return `編輯（${operation.edit}）`;
      case 'connect': return '開啟備份視窗並連結 Google Drive';
      case 'backup': return operation.force ? '按下「以本機資料覆蓋」' : '按下「立即備份」';
      case 'wait': return `停留 ${operation.minutes} 分鐘（自動備份可能執行）`;
      case 'restore': return `選第 ${operation.version + 1} 個雲端版本還原，然後${operation.decision === 'replace' ? '取代本機' : '取消'}`;
      case 'reload': return '重新整理頁面';
      case 'wipe': return operation.keepLocalStorage ? '網站資料被清除（IndexedDB 消失，localStorage 留著）' : '網站資料被清除（IndexedDB 與 localStorage 都消失）';
      case 'auto': return operation.enabled ? '開啟自動備份' : '關閉自動備份';
      case 'external': return '發布自己的備份';
      case 'drive-trash': return operation.target === 'snapshot-root' ? '把整個「新版快照」資料夾丟進垃圾桶' : '把最新一份備份資料夾丟進垃圾桶';
    }
  })();
  const extras = [
    operation.fault ? `${typeof operation.fault.at === 'number' ? `第 ${operation.fault.at + 1} 個 Drive 請求` : targetText[operation.fault.at]}${faultText[operation.fault.mode]}` : '',
    operation.storageFull ? 'localStorage 寫入失敗' : '',
    operation.editAt !== undefined ? `第 ${operation.editAt + 1} 個請求進行中使用者又編輯` : '',
    operation.externalAt !== undefined ? `第 ${operation.externalAt + 1} 個請求進行中另一台裝置發布備份` : '',
  ].filter(Boolean);
  return `${who}：${action}${extras.length ? `〔${extras.join('；')}〕` : ''}`;
};
