import { useEffect, useRef } from 'react';

const workspaceUiHistoryKey = '__boardGameHelperWorkspaceUi';

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
  const onBackRef = useRef(onBack);
  const historyDepthRef = useRef(0);
  const suppressPopRef = useRef(false);
  const keyboardStateRef = useRef({ open: false, recentlyClosedUntil: 0 });

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

    const handlePopState = () => {
      if (suppressPopRef.current) {
        suppressPopRef.current = false;
        return;
      }
      if (historyDepthRef.current <= 0) return;

      const keyboardState = keyboardStateRef.current;
      const keyboardWasRecentlyActive = keyboardState.open || keyboardState.recentlyClosedUntil > Date.now();
      if (keyboardWasRecentlyActive) {
        keyboardStateRef.current = { open: false, recentlyClosedUntil: 0 };
        window.history.pushState({ ...(window.history.state ?? {}), [workspaceUiHistoryKey]: true }, '');
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
  }, []);

  useEffect(() => {
    const targetDepth = active ? Math.max(1, Math.floor(layerCount)) : 0;
    const currentDepth = historyDepthRef.current;
    if (targetDepth > currentDepth) {
      for (let index = currentDepth; index < targetDepth; index += 1) {
        window.history.pushState({ ...(window.history.state ?? {}), [workspaceUiHistoryKey]: true }, '');
      }
      historyDepthRef.current = targetDepth;
      return;
    }

    if (targetDepth >= currentDepth) return;
    const distance = currentDepth - targetDepth;
    historyDepthRef.current = targetDepth;
    suppressPopRef.current = true;
    if (distance === 1) window.history.back();
    else window.history.go(-distance);
  }, [active, layerCount]);

  useEffect(() => () => {
    if (historyDepthRef.current <= 0) return;
    const distance = historyDepthRef.current;
    historyDepthRef.current = 0;
    suppressPopRef.current = true;
    if (distance === 1) window.history.back();
    else window.history.go(-distance);
  }, []);
};
