import { useLayoutEffect, useRef } from 'react';

type GameTab = { id: string; name: string };

// Names the game each featured card belongs to and switches between them; the selected name is shown in full.
export const HomeGameTabs = ({ games, active, onSelect }: { games: GameTab[]; active: number; onSelect(index: number): void }) => {
  const rowRef = useRef<HTMLDivElement>(null);

  // Keep the selected tab inside the row after a swipe or a tap; it widens once its full name shows.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const tab = row?.children[active] as HTMLElement | undefined;
    if (!row || !tab) return;
    const inset = 18;
    if (tab.offsetLeft - inset < row.scrollLeft) row.scrollLeft = Math.max(0, tab.offsetLeft - inset);
    else if (tab.offsetLeft + tab.offsetWidth + inset > row.scrollLeft + row.clientWidth) row.scrollLeft = tab.offsetLeft + tab.offsetWidth + inset - row.clientWidth;
  }, [active, games.length]);

  return <div ref={rowRef} className="home-game-tabs" role="tablist" aria-label="近期常被查閱的遊戲">
    {games.map((game, index) => <button
      key={game.id}
      type="button"
      role="tab"
      aria-selected={index === active}
      className={index === active ? 'active' : undefined}
      title={game.name}
      onClick={() => onSelect(index)}
    ><span>{game.name}</span></button>)}
  </div>;
};
