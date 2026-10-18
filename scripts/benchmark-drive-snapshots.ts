/** Synthetic desktop XLSX baseline. Does not contact Drive or access user data.
 * Run: node --expose-gc --import tsx scripts/benchmark-drive-snapshots.ts
 * Each size runs in a fresh process so earlier exports do not distort memory. */
import { spawnSync } from 'node:child_process';
import { createColumn, createNode, createTable } from '../src/workspace/model';
import { exportWorkspaceXlsxAsync } from '../src/workspace/spreadsheet';
import type { WorkspaceData, WorkspaceTable } from '../src/workspace/types';

const count = Number(process.argv.find(arg => arg.startsWith('--rows='))?.split('=')[1]);
if (!count) {
  const results = [500, 2000, 10000].map(rows => {
    const child = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', process.argv[1], `--rows=${rows}`], { encoding: 'utf8' });
    if (child.status !== 0) throw new Error(child.stderr || 'Benchmark failed');
    return JSON.parse(child.stdout);
  });
  console.log(JSON.stringify({ runtime: process.version, platform: `${process.platform}/${process.arch}`,
    scope: 'Synthetic single-table XLSX encoding only; excludes Drive/network/restore and is not a mobile estimate.', results }, null, 2));
} else {
  globalThis.gc?.();
  const baseline = process.memoryUsage();
  let peakHeap = baseline.heapUsed;
  let peakRss = baseline.rss;
  const sample = () => { const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss); };
  const timer = setInterval(sample, 1);
  const started = performance.now();
  let table: WorkspaceTable | undefined = createTable('Synthetic backup');
  table.columns = Array.from({ length: 12 }, (_, index) => createColumn(`Column ${index}`, index % 3 ? 'text' : 'number'));
  table.rows = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, name: `Item ${index}`,
    values: Object.fromEntries(table!.columns.map((column, c) => [column.id, c % 3 ? `Value ${index % 31}-${c}` : index * (c + 1)])) }));
  const node = createNode('table', table.name, null, 0, table.id);
  const directory: WorkspaceData = { version: 1, nodes: [node], tables: [], activeNodeId: node.id };
  const body = await exportWorkspaceXlsxAsync(directory, table);
  sample();
  clearInterval(timer);
  const result = { rows: count, dataColumns: 12, milliseconds: Math.round(performance.now() - started), xlsxBytes: body.size,
    peakHeapIncreaseMiB: +(Math.max(0, peakHeap - baseline.heapUsed) / 1048576).toFixed(1),
    peakRssIncreaseMiB: +(Math.max(0, peakRss - baseline.rss) / 1048576).toFixed(1) };
  table = undefined;
  console.log(JSON.stringify(result));
}
