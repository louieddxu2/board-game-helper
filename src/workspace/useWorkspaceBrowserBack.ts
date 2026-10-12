import { useCallback, useEffect, useId, useRef, useState } from 'react';

const workspaceUiHistoryKey = '__boardGameHelperWorkspaceUi';

type UiHistoryEntry = { owner: string; depth: number };
const readUiHistoryEntry = (state: unknown): UiHistoryEntry | undefined => {
  if (!state || typeof state !== 'object') return undefined;
  const entry = (state as Record<string, unknown>)[workspaceUiHistoryKey];
  if (!entry || typeof entry !== 'object') return undefined;
  const { owner, depth } = entry as Partial<UiHistoryEntry>;
  if (typeof owner !== 'string' || typeof depth !== 'number') return undefined;
  return { owner, depth };
};

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
  /** Number of transient layers currently stacked above the route. */
  layerCount?: number;
}

/**
 * Gives transient Workspace UI its own same-URL history entry.
 *
 * A normal close removes that entry again. A browser-back consumes it and
 * calls onBack, leaving the current route in place. If the keyboard is still
 * shrinking the visual viewport, the entry is restored and no UI layer is
 * dismissed; this lets the first back press only hide the keyboard.
 */
export const useWorkspaceBrowserBack = ({ active, onBack, layerCount = 1 }: UseWorkspaceBrowserBackOptions) => {
  const owner = useId();
  const onBackRef = useRef(onBack);
  const historyDepthRef = useRef(0);
  const suppressPopRef = useRef(false);
  const keyboardStateRef = useRef({ open: false, recentlyClosedUntil: 0 });
  const pushUiHistory = useCallback((depth: number) => {
    window.history.pushState({ ...(window.history.state ?? {}), [workspaceUiHistoryKey]: { owner, depth } }, '');
  }, [owner]);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const updateKeyboardState = () => {
      const open = isWorkspaceVirtualKeyboardOpen();
      if (open) {
        keyboardStateRef.current = { open: true, recentlyClosedUntil: 0 };
      } else if (keyboardStateRef.current.open) {
        keyboardStateRef.current = { open: false, recentlyClosedUntil: Date.now() + 500 };
      }
    };
    const viewport = window.visualViewport;
    updateKeyboardState();
    viewport?.addEventListener('resize', updateKeyboardState);
    viewport?.addEventListener('scroll', updateKeyboardState);
    window.addEventListener('resize', updateKeyboardState);

    const handlePopState = (event: PopStateEvent) => {
      if (suppressPopRef.current) {
        suppressPopRef.current = false;
        // A close can still be traversing history when the UI is reopened.
        // Restore the reopened layer on the landing entry instead of letting
        // the pending Back leave it open without a history entry of its own.
        const target = readUiHistoryEntry(event.state);
        if (historyDepthRef.current > 0 && (target?.owner !== owner || target.depth < historyDepthRef.current)) {
          for (let index = 1; index <= historyDepthRef.current; index += 1) pushUiHistory(index);
        }
        return;
      }
      if (historyDepthRef.current <= 0) return;

      // A Back from a newer overlay lands on this owner's entry. Leave the
      // lower overlay open; only the owner of the departed entry dismisses.
      const target = readUiHistoryEntry(event.state);
      if (target?.owner === owner && target.depth >= historyDepthRef.current) return;

      const keyboardState = keyboardStateRef.current;
      const keyboardWasRecentlyActive = keyboardState.open || keyboardState.recentlyClosedUntil > Date.now();
      if (keyboardWasRecentlyActive) {
        keyboardStateRef.current = { open: false, recentlyClosedUntil: 0 };
        pushUiHistory(historyDepthRef.current);
        return;
      }

      historyDepthRef.current = Math.max(0, historyDepthRef.current - 1);
      onBackRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      viewport?.removeEventListener('resize', updateKeyboardState);
      viewport?.removeEventListener('scroll', updateKeyboardState);
      window.removeEventListener('resize', updateKeyboardState);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [owner, pushUiHistory]);

  useEffect(() => {
    const targetDepth = active ? Math.max(1, Math.floor(layerCount)) : 0;
    const currentDepth = historyDepthRef.current;
    if (targetDepth > currentDepth) {
      for (let index = currentDepth; index < targetDepth; index += 1) {
        pushUiHistory(index + 1);
      }
      historyDepthRef.current = targetDepth;
      return;
    }

    if (targetDepth >= currentDepth) return;
    const distance = currentDepth - targetDepth;
    historyDepthRef.current = targetDepth;
    if (readUiHistoryEntry(window.history.state)?.owner !== owner) return;
    suppressPopRef.current = true;
    if (distance === 1) window.history.back();
    else window.history.go(-distance);
  }, [active, layerCount, owner, pushUiHistory]);

  useEffect(() => () => {
    if (historyDepthRef.current <= 0) return;
    const distance = historyDepthRef.current;
    historyDepthRef.current = 0;
    if (readUiHistoryEntry(window.history.state)?.owner !== owner) return;
    suppressPopRef.current = true;
    if (distance === 1) window.history.back();
    else window.history.go(-distance);
  }, [owner]);

  // Navigation can replace the transient entry with its destination instead
  // of pushing a route and then accidentally backing out of it during cleanup.
  return useCallback(() => {
    const replace = historyDepthRef.current > 0 && readUiHistoryEntry(window.history.state)?.owner === owner;
    historyDepthRef.current = 0;
    suppressPopRef.current = false;
    keyboardStateRef.current = { open: false, recentlyClosedUntil: 0 };
    return replace;
  }, [owner]);
};
