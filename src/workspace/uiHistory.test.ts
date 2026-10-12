import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { UiHistory } from './uiHistory';

const markerKey = '__boardGameHelperWorkspaceUi';
let coordinator: UiHistory;
let pops = 0;
let baseIndex = 0;
let sequence = 0;
const countPop = () => { pops++; };
const marker = () => window.history.state?.[markerKey];
const baseline = () => expect(window.location.pathname).toBe('/history-coordinator/current');
const traverse = async (distance: number) => {
  const before = pops;
  window.history.go(distance);
  await waitFor(() => expect(pops).toBeGreaterThan(before));
};

beforeEach(() => {
  window.sessionStorage.clear();
  const index = window.history.state?.idx ?? 0;
  window.history.pushState({ idx: index + 1, custom: 'previous' }, '', '/history-coordinator/previous');
  baseIndex = index + 2;
  window.history.pushState({ idx: baseIndex, custom: 'baseline', test: ++sequence }, '', '/history-coordinator/current');
  pops = 0;
  // Register before the coordinator's capture handler so every actual POP is
  // observable even when it intentionally suppresses Router listeners.
  window.addEventListener('popstate', countPop, true);
  coordinator = new UiHistory();
  coordinator.install(() => false);
});

afterEach(async () => {
  coordinator.navigate(() => undefined);
  await waitFor(() => expect(marker()).toBeUndefined());
  coordinator.dispose();
  window.removeEventListener('popstate', countPop, true);
});

describe.sequential('UI history traversal races and document recovery', () => {
  it('releases a close traversal canceled by a raw push, and skips obsolete UI in both directions', async () => {
    const dismiss = vi.fn();
    coordinator.update('dialog', 1, dismiss, () => true);
    coordinator.update('dialog', 0, dismiss, () => true);
    const destinationIndex = window.history.state.idx + 1;
    window.history.pushState({ idx: destinationIndex }, '', '/history-coordinator/destination');
    coordinator.observeRoute();

    expect(window.location.pathname).toBe('/history-coordinator/destination');
    expect(window.history.state.idx).toBe(destinationIndex);
    expect(dismiss).not.toHaveBeenCalled();
    // A canceled POP must not leave the coordinator permanently pending.
    coordinator.update('new-dialog', 1, dismiss, () => true);
    expect(marker()?.owner).toBe('new-dialog');
    coordinator.update('new-dialog', 0, dismiss, () => true);
    await waitFor(() => expect(marker()).toBeUndefined());

    await traverse(-1);
    await waitFor(baseline);
    expect(marker()).toBeUndefined();
    await traverse(-1);
    await waitFor(() => expect(window.location.pathname).toBe('/history-coordinator/previous'));
    await traverse(1);
    await waitFor(baseline);
    await traverse(1);
    await waitFor(() => expect(window.location.pathname).toBe('/history-coordinator/destination'));
  });

  it('restores all entries on the original route when a busy top layer receives go(-N)', async () => {
    const lower = vi.fn();
    const top = vi.fn();
    let busy = true;
    coordinator.update('lower', 1, lower, () => true);
    coordinator.update('top', 1, top, () => !busy);

    await traverse(-3);
    await waitFor(() => expect(pops).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(marker()?.stack).toHaveLength(2));
    baseline();
    expect(window.history.state.idx).toBe(baseIndex + 2);
    expect(lower).not.toHaveBeenCalled();
    expect(top).not.toHaveBeenCalled();

    busy = false;
    await traverse(-1);
    await waitFor(() => expect(top).toHaveBeenCalledTimes(1));
    expect(lower).not.toHaveBeenCalled();
    await traverse(-1);
    await waitFor(() => expect(lower).toHaveBeenCalledTimes(1));
    baseline();
  });

  it('consumes several UI entries without leaving the route when go(-N) crosses the baseline', async () => {
    const lower = vi.fn();
    const top = vi.fn();
    coordinator.update('lower', 1, lower, () => true);
    coordinator.update('top', 1, top, () => true);
    await traverse(-3);
    await waitFor(baseline);
    expect(marker()).toBeUndefined();
    expect(lower).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledTimes(1);
    await traverse(-1);
    await waitFor(() => expect(window.location.pathname).toBe('/history-coordinator/previous'));
  });

  it('retains the Forward destination for obsolete UI across document recreation', async () => {
    const dismiss = vi.fn();
    coordinator.update('dialog', 1, dismiss, () => true);
    window.history.pushState({ idx: window.history.state.idx + 1 }, '', '/history-coordinator/destination');
    coordinator.observeRoute();
    expect(dismiss).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    coordinator = new UiHistory();
    coordinator.install(() => false);

    await traverse(-1);
    await waitFor(baseline);
    expect(marker()).toBeUndefined();
    await traverse(1);
    await waitFor(() => expect(window.location.pathname).toBe('/history-coordinator/destination'));
    expect(marker()).toBeUndefined();
  });

  it('removes orphan entries from the previous owner/depth format on startup', async () => {
    coordinator.dispose();
    window.history.pushState({ idx: baseIndex, [markerKey]: { owner: 'old-lower', depth: 1 } }, '');
    window.history.pushState({ idx: baseIndex, [markerKey]: { owner: 'old-top', depth: 1 } }, '');
    coordinator = new UiHistory();
    coordinator.install(() => false);
    await waitFor(() => expect(pops).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(marker()).toBeUndefined());
    expect(window.history.state.custom).toBe('baseline');
    baseline();
    await traverse(-1);
    await waitFor(() => expect(window.location.pathname).toBe('/history-coordinator/previous'));
  });
});
