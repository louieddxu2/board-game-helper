import { readFile } from 'node:fs/promises';
import { applyAttributeCatalogChanges } from '../src/lib/attributeCatalog';
import type { AttributeCatalogChangesPayload, AttributeCatalogPayload } from '../src/shared/types';
import { buildWinMergePreview, renderWinMergePreview } from './bipolar-merge-preview';

// Read-only: stdout only, no database or filesystem writes. Optional local catalog path supports offline replay.
const source = process.argv[2];
if (!source) throw new Error('Usage: npx tsx scripts/preview-win-merge.ts <catalog.json or https://origin>');
let catalog: AttributeCatalogPayload;
if (source.startsWith('https://')) {
  const origin = new URL(source).origin;
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    return response.json() as Promise<T>;
  };
  catalog = await get<AttributeCatalogPayload>('/api/attributes/table');
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error('catalog_did_not_converge');
    const delta = await get<AttributeCatalogChangesPayload>(`/api/attributes/table/changes?after=${catalog.throughVersion}`);
    if (delta.throughVersion < catalog.throughVersion || (delta.hasMore && delta.throughVersion <= catalog.throughVersion)) throw new Error('invalid_delta_progress');
    catalog = applyAttributeCatalogChanges(catalog, delta.changes, delta.throughVersion);
    if (!delta.hasMore) break;
  }
} else {
  catalog = JSON.parse(await readFile(source, 'utf8')) as AttributeCatalogPayload;
}
const preview = buildWinMergePreview(catalog);
const fetchedAt = new Date().toISOString();
console.log(JSON.stringify({ source, fetchedAt, preview, markdown: renderWinMergePreview(preview, fetchedAt, source) }));
