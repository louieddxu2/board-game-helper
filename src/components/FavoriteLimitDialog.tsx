import { useEffect, useRef } from 'react';
import type { PersonalHomeGame } from '../shared/types';

interface Props {
  games: PersonalHomeGame[];
  busyId?: string;
  onRemove(game: PersonalHomeGame): void;
  onClose(): void;
}

export const FavoriteLimitDialog = ({ games, busyId, onRemove, onClose }: Props) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyId) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busyId, onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busyId) onClose();
  }}>
  <section className="modal confirm-dialog favorite-limit-dialog" role="dialog" aria-modal="true" aria-labelledby="favorite-limit-title">
    <h2 id="favorite-limit-title">收藏已達六款</h2>
    <p>請先移除一款遊戲，再重新收藏目前這款。</p>
    <div className="favorite-limit-list">
      {games.map((game) => <div key={game.id}>
        <span>{game.displayName}</span>
        <button type="button" className="button secondary" disabled={Boolean(busyId)} onClick={() => onRemove(game)}>
          {busyId === game.id ? '移除中…' : '移除'}
        </button>
      </div>)}
    </div>
    <button ref={closeRef} type="button" className="button secondary" disabled={Boolean(busyId)} onClick={onClose}>取消</button>
  </section>
</div>;
};
