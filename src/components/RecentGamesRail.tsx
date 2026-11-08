import { Link } from 'react-router-dom';

type RecentGame = { id: string; slug: string; displayName: string };

export const RecentGamesRail = ({ games, className = '' }: { games: RecentGame[]; className?: string }) => {
  return <div
    className={`recent-games-rail ${className}`}
    data-drag-scroll
    role="navigation"
    aria-label="最近看過的遊戲"
  >
    {games.slice(0, 6).map(game => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}
  </div>;
};
