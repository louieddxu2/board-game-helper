import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createBrowserRouter } from 'react-router-dom';
import { uiHistory } from './uiHistory';
import { connectUiHistoryRouter } from './uiHistoryRouter';

let router: ReturnType<typeof createBrowserRouter>;
let disconnect: () => void;
let baseIndex = 0;
const markerKey = '__boardGameHelperWorkspaceUi';
const at = (path: string) => waitFor(() => {
  expect(window.location.pathname).toBe(path);
  expect(router.state.location.pathname).toBe(path);
});

beforeEach(() => {
  uiHistory.dispose();
  window.sessionStorage.clear();
  const index = window.history.state?.idx ?? 0;
  window.history.pushState({ idx: index + 1, key: 'previous' }, '', '/router-history/previous');
  baseIndex = index + 2;
  window.history.pushState({ idx: baseIndex, key: 'current' }, '', '/router-history/current');
  uiHistory.install(() => false);
  router = createBrowserRouter([{ path: '/router-history/:page' }]);
  disconnect = connectUiHistoryRouter(router);
});

afterEach(async () => {
  uiHistory.navigate(() => undefined);
  await waitFor(() => expect(window.history.state?.[markerKey]).toBeUndefined());
  disconnect();
  router.dispose();
  uiHistory.dispose();
});

describe.sequential('Router navigation waits for UI history cleanup', () => {
  it('collapses all UI before ordinary navigation pushes its destination', async () => {
    const lower = vi.fn();
    const top = vi.fn();
    uiHistory.update('lower', 1, lower, () => true);
    uiHistory.update('top', 1, top, () => true);
    await router.navigate('/router-history/destination');
    await at('/router-history/destination');
    expect(window.history.state.idx).toBe(baseIndex + 1);
    expect(lower).toHaveBeenCalledTimes(1);
    expect(top).toHaveBeenCalledTimes(1);
    expect(window.history.state[markerKey]).toBeUndefined();

    window.history.back();
    await at('/router-history/current');
    window.history.back();
    await at('/router-history/previous');
  });

  it('waits for a pending manual close instead of canceling its traversal', async () => {
    const dismiss = vi.fn();
    uiHistory.update('dialog', 1, dismiss, () => true);
    uiHistory.update('dialog', 0, dismiss, () => true);
    await router.navigate('/router-history/destination');
    await at('/router-history/destination');
    expect(window.history.state.idx).toBe(baseIndex + 1);
    expect(dismiss).not.toHaveBeenCalled();
    window.history.back();
    await at('/router-history/current');
    window.history.back();
    await at('/router-history/previous');
  });

  it('replaces the baseline route after dismissing UI rather than replacing a UI entry', async () => {
    const dismiss = vi.fn();
    uiHistory.update('dialog', 1, dismiss, () => true);
    await router.navigate('/router-history/destination', { replace: true });
    await at('/router-history/destination');
    expect(window.history.state.idx).toBe(baseIndex);
    expect(dismiss).toHaveBeenCalledTimes(1);
    window.history.back();
    await at('/router-history/previous');
  });

  it('uses the latest navigation requested during cleanup', async () => {
    uiHistory.update('dialog', 1, vi.fn(), () => true);
    await router.navigate('/router-history/first');
    await router.navigate('/router-history/latest');
    await at('/router-history/latest');
    expect(window.history.state.idx).toBe(baseIndex + 1);
    window.history.back();
    await at('/router-history/current');
  });
});
