import { useLayoutEffect, useRef } from 'react';

type GameTab = { id: string; name: string; altName?: string };

// Pixels per second a selected tab's cut-off line moves at, with the pause at each end in the keyframes.
const MARQUEE_SPEED = 30;

const centerTab = (row: HTMLElement, index: number, behavior: ScrollBehavior) => {
  const tab = row.children[index] as HTMLElement | undefined;
  if (!tab) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  row.scrollTo({ left: tab.offsetLeft + tab.offsetWidth / 2 - row.clientWidth / 2, behavior: reduceMotion ? 'auto' : behavior });
};

// The selected tab scrolls each line that does not fit, back and forth; the others end in an ellipsis.
const runMarquees = (row: HTMLElement, active: number) => {
  row.querySelectorAll<HTMLElement>('.home-game-tab-line').forEach(line => {
    delete line.dataset.marquee;
    line.style.removeProperty('--marquee-shift');
    line.style.removeProperty('--marquee-duration');
  });
  const tab = row.children[active] as HTMLElement | undefined;
  tab?.querySelectorAll<HTMLElement>('.home-game-tab-line').forEach(line => {
    const overflow = line.scrollWidth - line.clientWidth;
    if (overflow <= 1) return;
    line.dataset.marquee = '';
    line.style.setProperty('--marquee-shift', `${-overflow}px`);
    // The move takes 60% of the cycle; the rest is the pause at each end.
    line.style.setProperty('--marquee-duration', `${(overflow / MARQUEE_SPEED / 0.6).toFixed(2)}s`);
  });
};

// Names the game each featured card belongs to and switches between them. Every tab keeps one width, at most
// eight full-width characters, so the row stays still while swiping; the selected tab sits in the centre.
export const HomeGameTabs = ({ games, active, onSelect }: { games: GameTab[]; active: number; onSelect(index: number): void }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const gamesKey = games.map(game => `${game.id}:${game.altName ?? ''}`).join(',');

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
    centerTab(row, active, placed.current ? 'smooth' : 'auto');
    placed.current = true;
    runMarquees(row, active);
    // Web fonts can change how much of a line fits once they arrive.
    let current = true;
    void document.fonts?.ready.then(() => { if (current) runMarquees(row, active); });
    return () => { current = false; };
  }, [active, gamesKey]);

  return <div ref={rowRef} className="home-game-tabs" data-drag-scroll role="tablist" aria-label="近期常被查閱的遊戲">
    {games.map((game, index) => <button
      key={game.id}
      type="button"
      role="tab"
      aria-selected={index === active}
      className={index === active ? 'active' : undefined}
      title={game.altName ? `${game.name}（${game.altName}）` : game.name}
      onClick={() => onSelect(index)}
    >
      <span className="home-game-tab-line"><span>{game.name}</span></span>
      {game.altName && <span className="home-game-tab-line home-game-tab-alt"><span>{game.altName}</span></span>}
    </button>)}
  </div>;
};
