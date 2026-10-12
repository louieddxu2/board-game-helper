import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWorkspaceVirtualKeyboardOpen, useWorkspaceBrowserBack, useWorkspaceVirtualKeyboardOpen } from './useWorkspaceBrowserBack';

let baselineHistoryState: unknown;
let baselineHistoryUrl = '';
let pushStateSpy: ReturnType<typeof vi.spyOn>;
let backSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  baselineHistoryState = window.history.state;
  baselineHistoryUrl = window.location.href;
  // Keep pushState real so the hook's ownership checks see the state it writes.
  // Back is mocked in these unit tests so cleanup cannot asynchronously move the
  // shared jsdom history while a case is still asserting its callbacks.
  pushStateSpy = vi.spyOn(window.history, 'pushState');
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  pushStateSpy.mockRestore();
  backSpy.mockRestore();
  window.history.replaceState(baselineHistoryState, '', baselineHistoryUrl);
  vi.useRealTimers();
});

describe('useWorkspaceBrowserBack', () => {
  it('reports a virtual keyboard only while an editable control owns the shrunken viewport', () => {
    const previousVisualViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    const visualViewport = Object.assign(new EventTarget(), { height: 800 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const input = document.createElement('input');
    document.body.append(input);
    const { result, unmount } = renderHook(() => useWorkspaceVirtualKeyboardOpen());

    act(() => input.focus());
    visualViewport.height = 300;
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    expect(result.current).toBe(true);

    visualViewport.height = 800;
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    expect(result.current).toBe(false);

    unmount();
    input.remove();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousInnerHeight });
  });

  it('dismisses the active transient layer without navigating the route', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    rerender({ active: false });
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('removes its same-URL history entry when the UI closes normally', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    rerender({ active: false });
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not dismiss the UI when the back action is used to close the keyboard', () => {
    const previousVisualViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    const visualViewport = Object.assign(new EventTarget(), { height: 300 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    expect(isWorkspaceVirtualKeyboardOpen()).toBe(true);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onBack).not.toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledTimes(2);

    rerender({ active: false });
    expect(backSpy).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousInnerHeight });
  });

  it('does not dismiss the UI when the keyboard closes just before popstate', () => {
    const previousVisualViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    const visualViewport = Object.assign(new EventTarget(), { height: 300 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    const onBack = vi.fn();
    const { unmount } = renderHook(() => useWorkspaceBrowserBack({ active: true, onBack }));

    visualViewport.height = 800;
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    expect(onBack).not.toHaveBeenCalled();
    expect(pushStateSpy).toHaveBeenCalledTimes(2);

    unmount();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousInnerHeight });
  });

  it('ignores the first back used to close the virtual keyboard, then dismisses on the next back', () => {
    const previousVisualViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    const visualViewport = Object.assign(new EventTarget(), { height: 300 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    vi.useFakeTimers();

    try {
      const onBack = vi.fn();
      renderHook(() => useWorkspaceBrowserBack({ active: true, onBack }));

      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      expect(onBack).not.toHaveBeenCalled();

      visualViewport.height = 800;
      act(() => visualViewport.dispatchEvent(new Event('resize')));
      act(() => vi.advanceTimersByTime(501));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      expect(onBack).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousInnerHeight });
    }
  });

  it('dismisses only the top owner when a stacked back lands on the lower owner entry', () => {
    const lowerBack = vi.fn();
    const topBack = vi.fn();
    const lower = renderHook(() => useWorkspaceBrowserBack({ active: true, onBack: lowerBack }));
    const lowerEntry = window.history.state;
    const top = renderHook(() => useWorkspaceBrowserBack({ active: true, onBack: topBack }));

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: lowerEntry })));

    expect(lowerBack).not.toHaveBeenCalled();
    expect(topBack).toHaveBeenCalledTimes(1);
    top.unmount();
    lower.unmount();
  });

  it('releases its owned entry for navigation without scheduling cleanup back', () => {
    const onBack = vi.fn();
    const { result, rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    expect(result.current()).toBe(true);
    rerender({ active: false });

    expect(backSpy).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('restores a reopened layer after a pending close pop, then closes on the next back', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    rerender({ active: false });
    rerender({ active: true });
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: baselineHistoryState })));
    expect(onBack).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: baselineHistoryState })));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
