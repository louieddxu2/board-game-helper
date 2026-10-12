import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { uiHistory } from './uiHistory';
import { useDialogScrollLock } from '../components/useDialogScrollLock';

export const isWorkspaceVirtualKeyboardOpen = () => {
  if (typeof window === 'undefined' || !window.visualViewport) return false;
  const viewportHeight = window.visualViewport.height;
  const layoutHeight = window.innerHeight;
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(layoutHeight) || layoutHeight <= 0) return false;

  // Browser chrome can change the visual viewport by a small amount. A keyboard
  // normally removes a much larger portion of the layout viewport, so keep a
  // conservative threshold to avoid swallowing a real browser-back action.
  const threshold = Math.max(120, layoutHeight * 0.25);
  return viewportHeight < layoutHeight - threshold;
};

const isKeyboardEditable = (element: Element | null): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(element.type);
};

/** Tracks a real on-screen keyboard without hiding navigation for a hardware-keyboard focus. */
export const useWorkspaceVirtualKeyboardOpen = () => {
  const [open, setOpen] = useState(false);
  const baselineHeightRef = useRef(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    const viewportHeight = () => viewport?.height ?? window.innerHeight;
    baselineHeightRef.current = Math.max(window.innerHeight, viewportHeight());

    let settleTimer: number | undefined;
    const update = () => {
      const focused = isKeyboardEditable(document.activeElement);
      const height = viewportHeight();
      if (!focused) {
        baselineHeightRef.current = Math.max(height, window.innerHeight);
        setOpen(false);
        return;
      }
      const baseline = Math.max(baselineHeightRef.current, height);
      const threshold = Math.max(120, baseline * 0.25);
      setOpen(isWorkspaceVirtualKeyboardOpen() || baseline - height > threshold);
    };
    const schedule = () => {
      update();
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(update, 120);
    };
    const captureFocusBaseline = () => {
      baselineHeightRef.current = Math.max(baselineHeightRef.current, viewportHeight(), window.innerHeight);
      schedule();
    };
    const resetOrientationBaseline = () => {
      baselineHeightRef.current = viewportHeight();
      schedule();
    };

    document.addEventListener('focusin', captureFocusBaseline);
    document.addEventListener('focusout', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', resetOrientationBaseline);
    update();
    return () => {
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      document.removeEventListener('focusin', captureFocusBaseline);
      document.removeEventListener('focusout', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', resetOrientationBaseline);
    };
  }, []);

  return open;
};

interface UseWorkspaceBrowserBackOptions {
  active: boolean;
  onBack(): void;
  layerCount?: number;
  /** Close several layers atomically (navigation or a multi-entry traversal). */
  onDismissLayers?(count: number): void;
  canDismiss?: boolean;
  lockScroll?: boolean;
}

/** Registers UI with the single history coordinator, independent of Router context. */
export const useWorkspaceBrowserBack = (options: UseWorkspaceBrowserBackOptions) => {
  useDialogScrollLock(options.active && options.lockScroll !== false);
  const owner = useId();
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const count = options.active ? Math.max(1, Math.floor(options.layerCount ?? 1)) : 0;
  useEffect(() => {
    uiHistory.install(isWorkspaceVirtualKeyboardOpen);
    uiHistory.update(owner, count,
      removed => latest.current.onDismissLayers ? latest.current.onDismissLayers(removed) : latest.current.onBack(),
      () => latest.current.canDismiss !== false);
  }, [owner, count]);
  useEffect(() => () => uiHistory.unmount(owner), [owner]);
  return useCallback((navigate: () => void) => uiHistory.navigate(navigate), []);
};
