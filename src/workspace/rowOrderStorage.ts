import { makeId } from './model';

export const workspaceRowOrderCapacity = 256;
export interface StoredWorkspaceRowOrderPage { tableId: string; pageId: string; rowIds: string[] }
export interface WorkspaceRowOrderSnapshot {
  pageIds: string[];
  pages: ReadonlyMap<string, StoredWorkspaceRowOrderPage>;
}

export const createWorkspaceRowOrder = (tableId: string, rowIds: readonly string[]): WorkspaceRowOrderSnapshot => {
  const pages = new Map<string, StoredWorkspaceRowOrderPage>();
  for (let start = 0; start < rowIds.length; start += workspaceRowOrderCapacity) {
    const pageId = makeId('order');
    pages.set(pageId, { tableId, pageId, rowIds: rowIds.slice(start, start + workspaceRowOrderCapacity) });
  }
  return { pageIds: [...pages.keys()], pages };
};

/** Stable page identities let an insertion/deletion leave subsequent order pages untouched. */
export const spliceWorkspaceRowOrder = (previous: WorkspaceRowOrderSnapshot, tableId: string, index: number, deleteCount: number, addedIds: readonly string[]): WorkspaceRowOrderSnapshot => {
  const total = previous.pageIds.reduce((sum, id) => sum + previous.pages.get(id)!.rowIds.length, 0);
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(deleteCount) || deleteCount < 0 || index + deleteCount > total) throw new Error('Invalid row order splice');
  if (!deleteCount && !addedIds.length) return previous;
  let offset = 0;
  let first = previous.pageIds.length;
  let last = first - 1;
  let startSlot = 0;
  let endSlot = 0;
  const end = index + deleteCount;
  for (let position = 0; position < previous.pageIds.length; position++) {
    const size = previous.pages.get(previous.pageIds[position])!.rowIds.length;
    if (first === previous.pageIds.length && (index < offset + size || (!deleteCount && index === offset + size && size < workspaceRowOrderCapacity))) {
      first = position;
      startSlot = index - offset;
    }
    if (first !== previous.pageIds.length && (end <= offset + size)) {
      last = position;
      endSlot = end - offset;
      break;
    }
    offset += size;
  }
  const prefix = first < previous.pageIds.length ? previous.pages.get(previous.pageIds[first])!.rowIds.slice(0, startSlot) : [];
  const suffix = last >= first ? previous.pages.get(previous.pageIds[last])!.rowIds.slice(endSlot) : [];
  const replacement = [...prefix, ...addedIds, ...suffix];
  const pages = new Map(previous.pages);
  const removedIds = previous.pageIds.slice(first, last + 1);
  for (const id of removedIds) pages.delete(id);
  const replacementIds: string[] = [];
  // Split overflow evenly so repeated insertions into the middle do not create tiny pages.
  const count = Math.ceil(replacement.length / workspaceRowOrderCapacity);
  const size = count ? Math.ceil(replacement.length / count) : 0;
  for (let start = 0; start < replacement.length; start += size) {
    const pageId = removedIds[replacementIds.length] ?? makeId('order');
    const rowIds = replacement.slice(start, start + size);
    const before = previous.pages.get(pageId);
    pages.set(pageId, before && before.rowIds.length === rowIds.length && before.rowIds.every((id, slot) => id === rowIds[slot])
      ? before : { tableId, pageId, rowIds });
    replacementIds.push(pageId);
  }
  const pageIds = [...previous.pageIds.slice(0, first), ...replacementIds, ...previous.pageIds.slice(last + 1)];
  const sameIds = pageIds.length === previous.pageIds.length && pageIds.every((id, position) => id === previous.pageIds[position]);
  return { pageIds: sameIds ? previous.pageIds : pageIds, pages };
};

export const reconcileWorkspaceRowOrder = (previous: WorkspaceRowOrderSnapshot, tableId: string, rowIds: readonly string[]) => {
  const before = previous.pageIds.flatMap(id => previous.pages.get(id)!.rowIds);
  let start = 0;
  while (start < before.length && start < rowIds.length && before[start] === rowIds[start]) start++;
  if (start === before.length && start === rowIds.length) return previous;
  let oldEnd = before.length;
  let newEnd = rowIds.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === rowIds[newEnd - 1]) { oldEnd--; newEnd--; }
  return spliceWorkspaceRowOrder(previous, tableId, start, oldEnd - start, rowIds.slice(start, newEnd));
};
