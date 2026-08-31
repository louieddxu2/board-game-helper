import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWorkspaceVirtualKeyboardOpen, useWorkspaceBrowserBack, useWorkspaceVirtualKeyboardOpen } from './useWorkspaceBrowserBack';

afterEach(() => cleanup());

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
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    expect(pushState).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();

    rerender({ active: false });
    expect(back).not.toHaveBeenCalled();
    pushState.mockRestore();
    back.mockRestore();
  });

  it('removes its same-URL history entry when the UI closes normally', () => {
    const onBack = vi.fn();
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    rerender({ active: false });
    expect(back).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    pushState.mockRestore();
    back.mockRestore();
  });

  it('does not dismiss the UI when the back action is used to close the keyboard', () => {
    const previousVisualViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    const visualViewport = Object.assign(new EventTarget(), { height: 300 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    const onBack = vi.fn();
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { rerender } = renderHook(({ active }) => useWorkspaceBrowserBack({ active, onBack }), { initialProps: { active: true } });

    expect(isWorkspaceVirtualKeyboardOpen()).toBe(true);
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onBack).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(2);

    rerender({ active: false });
    expect(back).toHaveBeenCalledTimes(1);
    pushState.mockRestore();
    back.mockRestore();
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
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useWorkspaceBrowserBack({ active: true, onBack }));

    visualViewport.height = 800;
    act(() => visualViewport.dispatchEvent(new Event('resize')));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    expect(onBack).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(2);

    unmount();
    pushState.mockRestore();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousInnerHeight });
  });
});
