// A row that scrolls sideways under a finger also follows a mouse drag. Rows opt in with
// data-drag-scroll; touch and pen keep the browser's native scrolling, so only mouse input is handled.

type Drag = { row: HTMLElement; pointerId: number; x: number; y: number; scrollLeft: number; moved: boolean; snaps: boolean };

// A drag past this many pixels counts as a swipe to the next snap point rather than back to the nearest one.
const SWIPE_DISTANCE = 40;
// Below this movement a press is still a click.
const CLICK_SLOP = 8;

// The glide a release starts, per row. A new drag on the row stops it first: left running, it would turn
// snapping back on in the middle of that drag, and the row would then jerk between the pointer and a snap point.
const pendingGlides = new WeakMap<HTMLElement, () => void>();
const stopGlide = (row: HTMLElement) => {
  pendingGlides.get(row)?.();
  pendingGlides.delete(row);
};

const snapPoints = (row: HTMLElement) => {
  const rowLeft = row.getBoundingClientRect().left + (parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0);
  const max = row.scrollWidth - row.clientWidth;
  return Array.from(row.children, (child) => Math.min(max, Math.max(0, row.scrollLeft + child.getBoundingClientRect().left - rowLeft)));
};

// Snapping is off while the row follows the pointer; on release the row glides to the snap point nearest
// where the drag left it, so a long drag keeps its distance. A short drag that would fall back to where
// it began moves one point in its direction instead. Snapping resumes once the row arrives.
// Whether the row snaps is read before the drag turns snapping off.
const release = (row: HTMLElement, snaps: boolean, start: number, dx: number) => {
  const finish = () => { delete row.dataset.dragging; };
  if (!snaps) { finish(); return; }
  const points = snapPoints(row);
  if (points.length === 0) { finish(); return; }
  const current = row.scrollLeft;
  const nearest = points.reduce((best, point) => Math.abs(point - current) < Math.abs(best - current) ? point : best, points[0]);
  const fellBack = Math.abs(nearest - start) < 1;
  const target = fellBack && dx <= -SWIPE_DISTANCE ? points.find((point) => point > start + 1) ?? nearest
    : fellBack && dx >= SWIPE_DISTANCE ? [...points].reverse().find((point) => point < start - 1) ?? nearest
      : nearest;
  if (Math.abs(target - current) < 1) { finish(); return; }
  // The last drag step can still report a scroll end; only arriving at the target counts.
  const stop = () => {
    window.clearTimeout(timer);
    row.removeEventListener('scrollend', arrived);
  };
  const arrived = () => {
    if (Math.abs(row.scrollLeft - target) > 2) return;
    stop();
    pendingGlides.delete(row);
    finish();
  };
  const timer = window.setTimeout(() => { stop(); pendingGlides.delete(row); finish(); }, 800);
  row.addEventListener('scrollend', arrived);
  pendingGlides.set(row, stop);
  row.scrollTo({ left: target, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};

export const startMouseDragScroll = (doc: Document = document) => {
  let drag: Drag | null = null;
  // The click that ends a drag does not open what the pointer happens to rest on.
  let suppressClick = false;
  // A cancelled drag still lands the row on a snap point.
  const cancel = () => {
    if (drag?.moved) release(drag.row, drag.snaps, drag.scrollLeft, 0);
    drag = null;
    suppressClick = false;
  };

  doc.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    if (event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target as Element | null;
    const row = target?.closest?.<HTMLElement>('[data-drag-scroll]');
    if (!row || row.scrollWidth <= row.clientWidth + 1 || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    drag = { row, pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: row.scrollLeft, moved: false,
      snaps: !/^(none)?$/.test(getComputedStyle(row).scrollSnapType || 'none') };
  }, true);

  doc.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) <= CLICK_SLOP || Math.abs(dx) <= Math.abs(event.clientY - drag.y)) return;
      drag.moved = true;
      stopGlide(drag.row);
      drag.row.dataset.dragging = 'true';
      drag.row.setPointerCapture?.(event.pointerId);
      doc.getSelection()?.removeAllRanges();
    }
    drag.row.scrollLeft = drag.scrollLeft - dx;
    event.preventDefault();
  }, true);

  doc.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { row, moved, scrollLeft, x, snaps } = drag;
    suppressClick = moved;
    drag = null;
    if (moved) release(row, snaps, scrollLeft, event.clientX - x);
  }, true);

  doc.addEventListener('pointercancel', cancel, true);

  doc.addEventListener('click', (event) => {
    if (suppressClick && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    suppressClick = false;
  }, true);

  // A mouse press in a row does not start a text selection: once the pointer left the row, the browser would
  // scroll the row itself to extend the selection, fighting the drag and making the row flicker.
  doc.addEventListener('selectstart', (event) => { if (drag) event.preventDefault(); }, true);

  // A link or image inside a row would otherwise start the browser's own drag and cancel the pointer.
  doc.addEventListener('dragstart', (event) => {
    if ((event.target as Element | null)?.closest?.('[data-drag-scroll]')) event.preventDefault();
  }, true);
};
