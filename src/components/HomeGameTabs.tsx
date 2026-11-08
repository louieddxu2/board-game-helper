import { useLayoutEffect, useRef } from 'react';

type GameTab = { id: string; name: string };

// Centres the selected tabs: one on a phone, the two or three games on screen on wider screens.
const centerTab = (row: HTMLElement, index: number, count: number, behavior: ScrollBehavior) => {
  const first = row.children[index] as HTMLElement | undefined;
  const last = (row.children[index + count - 1] ?? first) as HTMLElement | undefined;
  if (!first || !last) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  row.scrollTo({ left: (first.offsetLeft + last.offsetLeft + last.offsetWidth) / 2 - row.clientWidth / 2, behavior: reduceMotion ? 'auto' : behavior });
};

// Names the game each featured card belongs to and switches between them. The selected tab sits in the
// centre with its full name, and the row glides there so the change of game is visible.
export const HomeGameTabs = ({ games, active, count = 1, onSelect }: { games: GameTab[]; active: number; count?: number; onSelect(index: number): void }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const gamesKey = games.map(game => game.id).join(',');

  // The row scrolls exactly far enough for the first and last tabs to reach the centre, and no further.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const first = row.firstElementChild as HTMLElement | null;
      const last = row.lastElementChild as HTMLElement | null;
      if (!first || !last) return;
      row.style.paddingInlineStart = `${Math.max(0, (row.clientWidth - first.offsetWidth) / 2)}px`;
      row.style.paddingInlineEnd = `${Math.max(0, (row.clientWidth - last.offsetWidth) / 2)}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    Array.from(row.children).forEach(tab => observer.observe(tab));
    fit();
    return () => observer.disconnect();
  }, [gamesKey]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    centerTab(row, active, count, placed.current ? 'smooth' : 'auto');
    placed.current = true;
  }, [active, count, gamesKey]);

  return <div ref={rowRef} className="home-game-tabs" data-drag-scroll role="tablist" aria-multiselectable={count > 1 || undefined} aria-label="近期常被查閱的遊戲"
    // The selected tab widens to its full name; centre it again once it has its final width.
    onTransitionEnd={(event) => {
      if (event.propertyName === 'max-width' && event.target === rowRef.current?.children[active]) centerTab(rowRef.current, active, count, 'smooth');
    }}>
    {games.map((game, index) => <button
      key={game.id}
      type="button"
      role="tab"
      aria-selected={index >= active && index < active + count}
      className={index >= active && index < active + count ? 'active' : undefined}
      title={game.name}
      onClick={() => onSelect(index)}
    ><span>{game.name}</span></button>)}
  </div>;
};
