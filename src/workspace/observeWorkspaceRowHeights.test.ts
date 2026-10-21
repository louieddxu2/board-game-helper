import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeWorkspaceRowHeights } from './observeWorkspaceRowHeights';

type ObserverInstance = {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger(entries: ResizeObserverEntry[]): void;
};

let previousResizeObserver: typeof ResizeObserver | undefined;
let observer!: ObserverInstance;

class ResizeObserverMock {
  readonly callback: ResizeObserverCallback;
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observer = this;
  }

  trigger(entries: ResizeObserverEntry[]) {
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

const row = (id: string, height = 40) => {
  const element = document.createElement('tr');
  element.dataset.virtualRowId = id;
  const getBoundingClientRect = vi.fn(() => ({ height } as DOMRect));
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: getBoundingClientRect });
  return { element, getBoundingClientRect };
};

const entry = (target: HTMLTableRowElement, blockSize?: number): ResizeObserverEntry => ({
  target,
  borderBoxSize: blockSize === undefined ? [] : [{ blockSize, inlineSize: 100 }],
  contentBoxSize: [],
  contentRect: {} as DOMRectReadOnly,
} as unknown as ResizeObserverEntry);

beforeEach(() => {
  previousResizeObserver = globalThis.ResizeObserver;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeObserverMock });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: previousResizeObserver });
  vi.restoreAllMocks();
});

describe('observeWorkspaceRowHeights', () => {
  it('does not synchronously read geometry or measure rows', () => {
    const first = row('row-a');
    const second = row('row-b');
    const measureRow = vi.fn();

    observeWorkspaceRowHeights([first.element, second.element], measureRow);

    expect(first.getBoundingClientRect).not.toHaveBeenCalled();
    expect(second.getBoundingClientRect).not.toHaveBeenCalled();
    expect(measureRow).not.toHaveBeenCalled();
    expect(observer.observe).toHaveBeenNthCalledWith(1, first.element, { box: 'border-box' });
    expect(observer.observe).toHaveBeenNthCalledWith(2, second.element, { box: 'border-box' });
  });

  it('measures only rows reported by ResizeObserver', () => {
    const first = row('row-a');
    const second = row('row-b');
    const measureRow = vi.fn();
    observeWorkspaceRowHeights([first.element, second.element], measureRow);

    observer.trigger([entry(second.element, 52)]);

    expect(measureRow).toHaveBeenCalledExactlyOnceWith('row-b', 52);
    expect(first.getBoundingClientRect).not.toHaveBeenCalled();
    expect(second.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it('uses a valid border box without forcing a layout read', () => {
    const measured = row('row-a');
    const measureRow = vi.fn();
    observeWorkspaceRowHeights([measured.element], measureRow);

    observer.trigger([entry(measured.element, 64)]);

    expect(measured.getBoundingClientRect).not.toHaveBeenCalled();
    expect(measureRow).toHaveBeenCalledExactlyOnceWith('row-a', 64);
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back to one changed row for border box height %s', height => {
    const valid = row('row-a');
    const fallback = row('row-b', 47);
    const measureRow = vi.fn();
    observeWorkspaceRowHeights([valid.element, fallback.element], measureRow);

    observer.trigger([entry(fallback.element, height)]);

    expect(valid.getBoundingClientRect).not.toHaveBeenCalled();
    expect(fallback.getBoundingClientRect).toHaveBeenCalledExactlyOnceWith();
    expect(measureRow).toHaveBeenCalledExactlyOnceWith('row-b', 47);
  });

  it('ignores late callbacks after cleanup', () => {
    const measured = row('row-a');
    const measureRow = vi.fn();
    const cleanup = observeWorkspaceRowHeights([measured.element], measureRow);

    cleanup();
    observer.trigger([entry(measured.element, 64)]);

    expect(observer.disconnect).toHaveBeenCalledExactlyOnceWith();
    expect(measured.getBoundingClientRect).not.toHaveBeenCalled();
    expect(measureRow).not.toHaveBeenCalled();
  });
});
