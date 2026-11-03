import { useRef } from 'react';
import { Link } from 'react-router-dom';

type RecentGame = { id: string; slug: string; displayName: string };
type Drag = { pointerId: number; x: number; y: number; scrollLeft: number; moved: boolean };

export const RecentGamesRail = ({ games, className = '' }: { games: RecentGame[]; className?: string }) => {
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  return <div
    className={`recent-games-rail ${className}`}
    role="navigation"
    aria-label="最近看過的遊戲"
    onPointerDown={event => {
      // Each new press is independent, including the first tap after a cancelled drag.
      suppressClick.current = false;
      if (event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: event.currentTarget.scrollLeft, moved: false };
    }}
    onPointerMove={event => {
      const origin = drag.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (!origin.moved) {
        if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy)) return;
        origin.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = 'true';
      }
      event.currentTarget.scrollLeft = origin.scrollLeft - dx;
      event.preventDefault();
    }}
    onPointerUp={event => {
      if (drag.current?.pointerId !== event.pointerId) return;
      suppressClick.current = drag.current.moved;
      drag.current = null;
      delete event.currentTarget.dataset.dragging;
    }}
    onPointerCancel={event => {
      drag.current = null;
      suppressClick.current = false;
      delete event.currentTarget.dataset.dragging;
    }}
    onLostPointerCapture={event => {
      drag.current = null;
      delete event.currentTarget.dataset.dragging;
    }}
    onPointerLeave={() => {
      if (!drag.current?.moved) drag.current = null;
    }}
    onClickCapture={event => {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
      suppressClick.current = false;
    }}
    onDragStart={event => event.preventDefault()}
  >
    {games.slice(0, 6).map(game => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}
  </div>;
};
