/** Stores only measured height differences; updates and prefix sums visit logarithmic paths. */
export class SparseWorkspaceRowHeights {
  private heights = new Map<number, number>();
  private sums = new Map<number, number>();
  constructor(readonly count: number) {}
  offset(index: number) {
    let delta = 0;
    for (let cursor = index; cursor > 0; cursor -= cursor & -cursor) delta += this.sums.get(cursor) ?? 0;
    return index * 36 + delta;
  }
  measure(index: number, height: number) {
    if (index < 0 || index >= this.count || !Number.isFinite(height) || height <= 0) return false;
    const current = this.heights.get(index);
    const delta = height - (current ?? 36);
    if (current !== undefined && Math.abs(delta) < 0.5) return false;
    this.heights.set(index, height);
    if (delta === 0) return false;
    for (let cursor = index + 1; cursor <= this.count; cursor += cursor & -cursor) this.sums.set(cursor, (this.sums.get(cursor) ?? 0) + delta);
    return true;
  }
  indexAt(position: number) {
    let low = 0, high = Math.max(0, this.count - 1);
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (this.offset(middle) <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}
