/** Consume the browser's completed layout instead of forcing one before every paint. */
export const observeWorkspaceRowHeights = (
  elements: NodeListOf<HTMLTableRowElement> | readonly HTMLTableRowElement[],
  measureRow: (id: string, height: number) => void,
) => {
  let active = true;
  const observer = new ResizeObserver(entries => {
    if (!active) return;
    for (const entry of entries) {
      const row = entry.target as HTMLTableRowElement;
      const id = row.dataset.virtualRowId;
      if (!id) continue;
      const height = entry.borderBoxSize?.[0]?.blockSize;
      // Older engines may omit borderBoxSize. Only read the changed row in that case.
      measureRow(id, height !== undefined && Number.isFinite(height) && height > 0
        ? height : row.getBoundingClientRect().height);
    }
  });
  elements.forEach(element => observer.observe(element, { box: 'border-box' }));
  return () => { active = false; observer.disconnect(); };
};
