import type { PointerEvent } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableGestures } from './useTableGestures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); });

const setup = () => {
  const viewport = document.createElement('div');
  const table = document.createElement('table');
  viewport.append(table);
  document.body.append(viewport);
  let scrollTop = 240;
  Object.defineProperties(viewport, {
    clientHeight: { value: 100 }, scrollHeight: { value: 340 },
    clientWidth: { value: 100 }, scrollWidth: { value: 100 },
    scrollTop: { get: () => scrollTop, set: value => { scrollTop = Math.max(0, Math.min(240, value)); } },
  });
  viewport.setPointerCapture = vi.fn();
  const onOpenSearch = vi.fn();
  const view = renderHook(() => useTableGestures({
    table: undefined, data: undefined, commit: vi.fn(), setNotice: vi.fn(), minTextScale: 1,
    viewportRef: { current: viewport }, workspacePageRef: { current: null }, onOpenSearch,
  }));
  const event = (pull = 0, pointerId = 1) => ({
    pointerType: 'touch', button: 0, pointerId, clientX: 50, clientY: 300 - pull,
    currentTarget: viewport, target: viewport, preventDefault: vi.fn(),
  }) as unknown as PointerEvent<HTMLDivElement>;
  return {
    onOpenSearch, table,
    begin: (pointerId = 1) => act(() => view.result.current.beginTablePan(event(0, pointerId))),
    move: (pull: number) => act(() => view.result.current.moveTablePan(event(pull))),
    end: () => act(() => view.result.current.endTablePan(event())),
    wait: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
  };
};

describe('boundary search countdown', () => {
  it('never starts counting for a slight upward pull', () => {
    const gesture = setup();
    gesture.begin(); gesture.move(24); gesture.wait(2_000);
    expect(gesture.onOpenSearch).not.toHaveBeenCalled();
  });

  it('counts the full half-second only after the bounce reaches its limit', () => {
    const gesture = setup();
    gesture.begin(); gesture.move(24); gesture.wait(400);
    gesture.move(90);
    expect(gesture.table.style.getPropertyValue('--workspace-bounce-y')).toBe('-30.0px');
    gesture.wait(499);
    expect(gesture.onOpenSearch).not.toHaveBeenCalled();
    gesture.wait(1);
    expect(gesture.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('resets the countdown when the pull retreats below the limit', () => {
    const gesture = setup();
    gesture.begin(); gesture.move(90); gesture.wait(300);
    gesture.move(40); gesture.wait(700);
    expect(gesture.onOpenSearch).not.toHaveBeenCalled();
    gesture.move(90); gesture.wait(499);
    expect(gesture.onOpenSearch).not.toHaveBeenCalled();
    gesture.wait(1);
    expect(gesture.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('does not restart counting while the finger continues beyond the limit', () => {
    const gesture = setup();
    gesture.begin(); gesture.move(90); gesture.wait(300);
    gesture.move(110); gesture.wait(200);
    expect(gesture.onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('cancels when the finger lifts before the countdown ends', () => {
    const gesture = setup();
    gesture.begin(); gesture.move(90); gesture.wait(499);
    gesture.end(); gesture.wait(600);
    expect(gesture.onOpenSearch).not.toHaveBeenCalled();
  });

  it('cancels when a second finger begins a pinch', () => {
    const gesture = setup();
    gesture.begin(); gesture.move(90); gesture.wait(300);
    gesture.begin(2); gesture.wait(600);
    expect(gesture.onOpenSearch).not.toHaveBeenCalled();
  });
});
