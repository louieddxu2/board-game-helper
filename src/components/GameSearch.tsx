import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { GameSummary } from '../shared/types';

interface Props {
  value: string;
  onChange(value: string): void;
  onSelect(game: GameSummary): void;
  selectedId?: string;
  allowCreate?: boolean;
  onCreate?(name: string): void;
}

export const GameSearch = ({ value, onChange, onSelect, selectedId, allowCreate, onCreate }: Props) => {
  const query = useDebouncedValue(value.trim());
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query || selectedId) { setGames([]); return; }
    let active = true;
    setLoading(true);
    api.searchGames(query).then((response) => {
      if (active) setGames(response.games);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, selectedId]);
  return <div className="game-search">
    <label htmlFor="game-search-input">玩了哪款遊戲？</label>
    <div className={selectedId ? 'search-input selected' : 'search-input'}>
      <input id="game-search-input" value={value} onChange={(event) => onChange(event.target.value)}
        placeholder="輸入中文名、英文名或別名" autoComplete="off" />
      {selectedId && <span aria-hidden="true">✓</span>}
    </div>
    {!selectedId && (loading || games.length > 0 || (allowCreate && query)) && <div className="search-results" role="listbox">
      {loading && <p className="muted">尋找遊戲中…</p>}
      {games.map((game) => <button type="button" key={game.id} onClick={() => onSelect(game)} role="option">
        <strong>{game.displayName}</strong>
        {game.englishName && <span>{game.englishName}</span>}
        <small>{game.ruleCount} 條規則</small>
      </button>)}
      {!loading && games.length === 0 && allowCreate && query && <button type="button" className="create-result" onClick={() => onCreate?.(value.trim())}>
        ＋建立新遊戲「{value.trim()}」
      </button>}
    </div>}
  </div>;
};

