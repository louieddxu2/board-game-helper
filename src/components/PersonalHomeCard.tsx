import { Link } from 'react-router-dom';
import type { PersonalHomeGame } from '../shared/types';

export const PersonalHomeCard = ({ game }: { game: PersonalHomeGame }) => <Link
  className="personal-home-card"
  to={`/games/${game.slug}`}
  aria-label={`${game.displayName}${game.hasUpdates ? '，有新規則' : ''}`}
>
  <span className="personal-home-card-title">{game.displayName}</span>
  {game.hasUpdates && <span className="personal-home-unread" aria-hidden="true">新</span>}
  <span className="personal-home-rule">{game.latestRule?.statement ?? '目前尚無公開規則'}</span>
</Link>;
