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
}

/**
 * Gives transient Workspace UI its own same-URL history entry.
 *
 * A normal close removes that entry again. A browser-back consumes it and
 * calls onBack, leaving the current route in place. If the keyboard is still
 * shrinking the visual viewport, the entry is restored and no UI layer is
 * dismissed; this lets the first back press only hide the keyboard.
 */
export const useWorkspaceBrowserBack = ({ active, onBack }: UseWorkspaceBrowserBackOptions) => {
  const onBackRef = useRef(onBack);
  const activeRef = useRef(active);
  const guardActiveRef = useRef(false);
  const suppressPopRef = useRef(false);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const handlePopState = () => {
      if (suppressPopRef.current) {
        suppressPopRef.current = false;
        return;
      }
      if (!guardActiveRef.current) return;

      if (isWorkspaceVirtualKeyboardOpen()) {
        window.history.pushState({ ...(window.history.state ?? {}), [workspaceUiHistoryKey]: true }, '');
        guardActiveRef.current = true;
        return;
      }

      guardActiveRef.current = false;
      onBackRef.current();
      window.setTimeout(() => {
        if (!activeRef.current || guardActiveRef.current) return;
        window.history.pushState({ ...(window.history.state ?? {}), [workspaceUiHistoryKey]: true }, '');
        guardActiveRef.current = true;
      }, 0);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (active) {
      if (guardActiveRef.current) return;
      window.history.pushState({ ...(window.history.state ?? {}), [workspaceUiHistoryKey]: true }, '');
      guardActiveRef.current = true;
      return;
    }

    if (!guardActiveRef.current) return;
    guardActiveRef.current = false;
    suppressPopRef.current = true;
    window.history.back();
  }, [active]);

  useEffect(() => () => {
    if (!guardActiveRef.current) return;
    guardActiveRef.current = false;
    suppressPopRef.current = true;
    window.history.back();
  }, []);
};
