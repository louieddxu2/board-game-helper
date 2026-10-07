import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ensureWorkspaceCellVisible } from './workspaceShared';

/** Keep the active cell visible as the mobile keyboard changes the viewport. */
export const useWorkspaceCellFocus = (viewportRef: RefObject<HTMLDivElement | null>, activeCellKey: string | undefined, virtualKeyboardOpen: boolean) => {
  const activeElement = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState<number>();
  const setActiveCellElement = useCallback((element: HTMLElement | null) => { activeElement.current = element; }, []);

  useEffect(() => {
    if (!activeCellKey) return;
    let frame: number | undefined;
    let timer: number | undefined;
    const visualViewport = window.visualViewport;
    const keepVisible = () => {
      if (activeElement.current && viewportRef.current) ensureWorkspaceCellVisible(activeElement.current, viewportRef.current);
    };
    const schedule = () => {
      if (visualViewport && Number.isFinite(visualViewport.height) && visualViewport.height > 0) setHeight(visualViewport.height);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      frame = window.requestAnimationFrame(() => {
        keepVisible();
        timer = window.setTimeout(keepVisible, 160);
      });
    };
    schedule();
    visualViewport?.addEventListener('resize', schedule);
    visualViewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      visualViewport?.removeEventListener('resize', schedule);
      visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [activeCellKey, viewportRef, virtualKeyboardOpen]);

  const workspacePageStyle: CSSProperties | undefined = activeCellKey && height
    ? { height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px` } : undefined;
  return { setActiveCellElement, workspacePageStyle };
};
