import { useEffect, useRef, type ReactNode } from 'react';

export const GameActionsMenu = ({ children }: { children: ReactNode }) => {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  return <details ref={menu} className="game-actions-menu" onKeyDown={(event) => {
    if (event.key !== 'Escape' || !menu.current?.open) return;
    menu.current.open = false;
    menu.current.querySelector('summary')?.focus();
    event.stopPropagation();
  }}>
    <summary aria-label="更多遊戲操作">更多</summary>
    <div className="game-actions-menu-content" onClick={(event) => {
      if ((event.target as Element).closest('button, a') && menu.current) menu.current.open = false;
    }}>{children}</div>
  </details>;
};
