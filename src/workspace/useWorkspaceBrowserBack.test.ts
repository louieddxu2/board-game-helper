import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { StrictMode, createElement, Fragment, useEffect, useState, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uiHistory } from './uiHistory';
import { isWorkspaceVirtualKeyboardOpen, useWorkspaceBrowserBack, useWorkspaceVirtualKeyboardOpen } from './useWorkspaceBrowserBack';

const historyKey = '__boardGameHelperWorkspaceUi';
const auditPath = '/__workspace-browser-back-test';
let caseNumber = 0;
let popCount = 0;
const capturePop = () => { popCount += 1; };

type Layer = { owner: string; depth: number };
type Marker = Layer & { session: string; baseIndex: number; stack: Layer[] };

const readIndex = (state: unknown) => {
  const index = state && typeof state === 'object' ? (state as { idx?: unknown }).idx : undefined;
  return typeof index === 'number' ? index : 0;
};

const readMarker = (state: unknown): Marker | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const marker = (state as Record<string, unknown>)[historyKey];
  if (!marker || typeof marker !== 'object') return undefined;
  const candidate = marker as Partial<Marker>;
  if (typeof candidate.owner !== 'string' || typeof candidate.depth !== 'number' || typeof candidate.session !== 'string'
    || !Number.isInteger(candidate.baseIndex) || !Array.isArray(candidate.stack)) return undefined;
  return candidate as Marker;
};

const waitForMarker = async (depth: number | undefined) => {
  await waitFor(() => expect(readMarker(window.history.state)?.stack.length).toBe(depth));
};

const waitForRoute = async (path: string) => {
  await waitFor(() => expect(window.location.pathname).toBe(path));
};

const traverse = async (delta: number) => {
  const before = popCount;
  act(() => { window.history.go(delta); });
  await waitFor(() => expect(popCount).toBeGreaterThan(before));
};

const startHistoryCase = (name: string, customState: Record<string, unknown> = {}) => {
  const previousIndex = readIndex(window.history.state);
  const previousPath = `${auditPath}/${name}-${caseNumber += 1}-previous`;
  const currentPath = `${auditPath}/${name}-${caseNumber}-current`;
  window.history.pushState({ idx: previousIndex + 1, key: `${name}-previous`, ...customState }, '', previousPath);
  const currentIndex = previousIndex + 2;
  window.history.pushState({ idx: currentIndex, key: `${name}-current`, ...customState }, '', currentPath);
  return { previousPath, currentPath, currentIndex, length: window.history.length };
};

const RouteObserver = () => {
  const location = useLocation();
  useEffect(() => { uiHistory.observeRoute(); }, [location.key, location.pathname, location.search, location.hash]);
  return createElement('output', { 'data-testid': 'route' }, location.pathname, location.search, location.hash);
};

const RouterWrapper = ({ children }: PropsWithChildren) => createElement(BrowserRouter, null, createElement(RouteObserver), children);
const StrictRouterWrapper = ({ children }: PropsWithChildren) => createElement(BrowserRouter, null,
  createElement(StrictMode, null, createElement(RouteObserver), children));

const setViewport = (height: number, layoutHeight = 800) => {
  const previousViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const previousInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: layoutHeight });
  return {
    viewport,
    restore() {
      if (previousViewport) Object.defineProperty(window, 'visualViewport', previousViewport);
      else Reflect.deleteProperty(window, 'visualViewport');
      if (previousInnerHeight) Object.defineProperty(window, 'innerHeight', previousInnerHeight);
    },
  };
};

beforeEach(() => {
  uiHistory.dispose();
  popCount = 0;
  window.addEventListener('popstate', capturePop, true);
});

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(readMarker(window.history.state)).toBeUndefined(), { timeout: 1500 });
  uiHistory.dispose();
  window.removeEventListener('popstate', capturePop, true);
  vi.useRealTimers();
});

describe.sequential('useWorkspaceBrowserBack real history contract', () => {
  it('StrictMode initial active registration creates one entry and Back stays on the route', async () => {
    const base = startHistoryCase('strictmode');
    const onBack = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => useWorkspaceBrowserBack({ active, onBack }),
      { initialProps: { active: true }, wrapper: StrictRouterWrapper },
    );

    await waitForMarker(1);
    expect(window.history.length).toBe(base.length + 1);
    expect(readMarker(window.history.state)?.baseIndex).toBe(base.currentIndex);

    await traverse(-1);
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    await waitForMarker(undefined);
    await waitForRoute(base.currentPath);
    rerender({ active: false });
  });

  it('reducing a top owner from two layers to one does not dismiss the lower owner', async () => {
    const base = startHistoryCase('two-owner');
    const lowerBack = vi.fn();
    const topBack = vi.fn();
    const Owner = ({ topLayers }: { topLayers: number }) => createElement(Fragment, null,
      createElement(LowerOwner, { onBack: lowerBack }),
      createElement(TopOwner, { layerCount: topLayers, onBack: topBack }));
    const view = render(createElement(RouterWrapper, null, createElement(Owner, { topLayers: 2 })));
    await waitForMarker(3);
    view.rerender(createElement(RouterWrapper, null, createElement(Owner, { topLayers: 1 })));
    await waitForMarker(2);
    expect(lowerBack).not.toHaveBeenCalled();
    expect(topBack).not.toHaveBeenCalled();

    await traverse(-1);
    await waitForMarker(1);
    expect(topBack).toHaveBeenCalledTimes(1);
    expect(lowerBack).not.toHaveBeenCalled();
    await traverse(-1);
    await waitForMarker(undefined);
    expect(lowerBack).toHaveBeenCalledTimes(1);
    await waitForRoute(base.currentPath);
  });

  it('uses onDismissLayers for workspace menu then drawer Back in two real traversals', async () => {
    const base = startHistoryCase('workspace-layers');
    const WorkspaceLayers = () => {
      const [layers, setLayers] = useState(['node-menu', 'drawer']);
      useWorkspaceBrowserBack({
        active: layers.length > 0,
        layerCount: layers.length,
        onBack: () => setLayers([]),
        onDismissLayers: (count) => setLayers((current) => current.slice(count)),
        lockScroll: false,
      });
      return createElement('output', { 'data-testid': 'layers' }, layers.join(','));
    };
    render(createElement(RouterWrapper, null, createElement(WorkspaceLayers)));

    await waitForMarker(2);
    await traverse(-1);
    await waitForMarker(1);
    expect(screen.getByTestId('layers')).toHaveTextContent('drawer');
    await traverse(-1);
    await waitForMarker(undefined);
    expect(screen.getByTestId('layers')).toHaveTextContent('');
    await waitForRoute(base.currentPath);
  });

  it('skips a consumed Forward entry, then a reopened layer closes before the previous route', async () => {
    const base = startHistoryCase('forward-reopen');
    const Harness = () => {
      const [open, setOpen] = useState(true);
      useWorkspaceBrowserBack({ active: open, onBack: () => setOpen(false) });
      return createElement('button', { type: 'button', onClick: () => setOpen((value) => !value) }, open ? 'close' : 'reopen');
    };
    render(createElement(RouterWrapper, null, createElement(Harness)));

    await waitForMarker(1);
    await traverse(-1);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('reopen'));
    await waitForMarker(undefined);
    await waitForRoute(base.currentPath);

    act(() => { window.history.forward(); });
    await waitForMarker(undefined);
    await waitForRoute(base.currentPath);

    await act(async () => { screen.getByRole('button', { name: 'reopen' }).click(); });
    await waitForMarker(1);
    await act(async () => { screen.getByRole('button', { name: 'close' }).click(); });
    await waitForMarker(undefined);
    await traverse(-1);
    await waitForRoute(base.previousPath);
  });

  it('coalesces a rapid manual close and reopen into one owned entry', async () => {
    const base = startHistoryCase('rapid-reopen');
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack: vi.fn() }), {
      initialProps: { active: true },
      wrapper: RouterWrapper,
    });

    await waitForMarker(1);
    rerender({ active: false });
    rerender({ active: true });
    await waitForMarker(1);
    expect(window.history.length).toBe(base.length + 1);
    rerender({ active: false });
    await waitForMarker(undefined);
    await traverse(-1);
    await waitForRoute(base.previousPath);
  });

  it('closes lower and search owners before navigate, then Back returns to the original page', async () => {
    const base = startHistoryCase('search-navigation');
    const destination = `${base.currentPath}/destination`;
    const NavigationHarness = () => {
      const navigate = useNavigate();
      const [lowerOpen, setLowerOpen] = useState(true);
      const [searchOpen, setSearchOpen] = useState(true);
      useWorkspaceBrowserBack({ active: lowerOpen, onBack: () => setLowerOpen(false) });
      const navigateAfterClosing = useWorkspaceBrowserBack({ active: searchOpen, onBack: () => setSearchOpen(false) });
      return createElement(Fragment, null,
        createElement('output', { 'data-testid': 'navigation-state' }, JSON.stringify({ lowerOpen, searchOpen })),
        createElement('button', { type: 'button', onClick: () => navigateAfterClosing(() => navigate(destination)) }, 'navigate'));
    };
    render(createElement(RouterWrapper, null, createElement(NavigationHarness)));

    await waitForMarker(2);
    await act(async () => { screen.getByRole('button', { name: 'navigate' }).click(); });
    await waitForRoute(destination);
    await waitFor(() => expect(screen.getByTestId('navigation-state')).toHaveTextContent('"lowerOpen":false'));
    await waitFor(() => expect(screen.getByTestId('navigation-state')).toHaveTextContent('"searchOpen":false'));
    expect(readMarker(window.history.state)).toBeUndefined();

    await traverse(-1);
    await waitForRoute(base.currentPath);
    expect(screen.getByTestId('navigation-state')).toHaveTextContent('false');
    await traverse(-1);
    await waitForRoute(base.previousPath);
  });

  it('ordinary navigation clears transient ownership and Back/Forward skip its old entry', async () => {
    const base = startHistoryCase('ordinary-navigation');
    const destination = `${base.currentPath}/next`;
    const Harness = () => {
      const navigate = useNavigate();
      const [open, setOpen] = useState(true);
      useWorkspaceBrowserBack({ active: open, onBack: () => setOpen(false) });
      return createElement('button', { type: 'button', onClick: () => navigate(destination) }, 'link');
    };
    render(createElement(RouterWrapper, null, createElement(Harness)));
    await waitForMarker(1);
    await act(async () => { screen.getByRole('button', { name: 'link' }).click(); });
    await waitForRoute(destination);
    await waitForMarker(undefined);

    await traverse(-1);
    await waitForRoute(base.currentPath);
    await traverse(1);
    await waitForRoute(destination);
    expect(readMarker(window.history.state)).toBeUndefined();
  });

  it('restores a busy owner entry and dismisses it on the next eligible Back', async () => {
    const base = startHistoryCase('busy-owner');
    const onBack = vi.fn();
    const { rerender } = renderHook(({ busy }) => useWorkspaceBrowserBack({
      active: true,
      canDismiss: !busy,
      onBack,
    }), { initialProps: { busy: true }, wrapper: RouterWrapper });

    await waitForMarker(1);
    await traverse(-1);
    await waitForMarker(1);
    expect(onBack).not.toHaveBeenCalled();
    rerender({ busy: false });
    await traverse(-1);
    await waitForMarker(undefined);
    expect(onBack).toHaveBeenCalledTimes(1);
    await waitForRoute(base.currentPath);
  });

  it('restores the top owner for keyboard Back before dismissing top then lower', async () => {
    const base = startHistoryCase('keyboard-two-owner');
    const viewportState = setViewport(300);
    const lowerBack = vi.fn();
    const topBack = vi.fn();
    const Owners = () => createElement(Fragment, null,
      createElement(LowerOwner, { onBack: lowerBack }),
      createElement(TopOwner, { layerCount: 1, onBack: topBack }));
    try {
      render(createElement(RouterWrapper, null, createElement(Owners)));
      await waitForMarker(2);
      await traverse(-1);
      await waitForMarker(2);
      expect(lowerBack).not.toHaveBeenCalled();
      expect(topBack).not.toHaveBeenCalled();

      viewportState.viewport.height = 800;
      act(() => { viewportState.viewport.dispatchEvent(new Event('resize')); });
      await new Promise((resolve) => window.setTimeout(resolve, 550));
      await traverse(-1);
      await waitForMarker(1);
      expect(topBack).toHaveBeenCalledTimes(1);
      expect(lowerBack).not.toHaveBeenCalled();
      await traverse(-1);
      await waitForMarker(undefined);
      expect(lowerBack).toHaveBeenCalledTimes(1);
      await waitForRoute(base.currentPath);
    } finally {
      viewportState.restore();
    }
  });

  it('increments React Router idx per transient push and preserves custom state', async () => {
    const base = startHistoryCase('router-idx', { customState: 'preserve-me', usr: { source: 'test' } });
    const { unmount } = renderHook(() => useWorkspaceBrowserBack({ active: true, layerCount: 2, onBack: vi.fn() }), {
      wrapper: RouterWrapper,
    });

    await waitForMarker(2);
    expect(window.history.state.idx).toBe(base.currentIndex + 2);
    expect(window.history.state.customState).toBe('preserve-me');
    expect(window.history.state.usr).toEqual({ source: 'test' });
    expect(readMarker(window.history.state)?.baseIndex).toBe(base.currentIndex);
    unmount();
  });

  it('keeps the keyboard predicate limited to an editable focused control', () => {
    const previousViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const previousInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const viewport = Object.assign(new EventTarget(), { height: 800 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const input = document.createElement('input');
    document.body.append(input);
    try {
      const { result, unmount } = renderHook(() => useWorkspaceVirtualKeyboardOpen());
      act(() => { input.focus(); });
      viewport.height = 300;
      act(() => { viewport.dispatchEvent(new Event('resize')); });
      expect(isWorkspaceVirtualKeyboardOpen()).toBe(true);
      expect(result.current).toBe(true);
      viewport.height = 800;
      act(() => { viewport.dispatchEvent(new Event('resize')); });
      expect(result.current).toBe(false);
      unmount();
    } finally {
      input.remove();
      if (previousViewport) Object.defineProperty(window, 'visualViewport', previousViewport);
      else Reflect.deleteProperty(window, 'visualViewport');
      if (previousInnerHeight) Object.defineProperty(window, 'innerHeight', previousInnerHeight);
    }
  });
});

const LowerOwner = ({ onBack }: { onBack(): void }) => {
  useWorkspaceBrowserBack({ active: true, onBack });
  return null;
};

const TopOwner = ({ layerCount, onBack }: { layerCount: number; onBack(): void }) => {
  useWorkspaceBrowserBack({ active: true, layerCount, onBack });
  return null;
};
