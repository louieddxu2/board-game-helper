import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameSearch } from './GameSearch';

interface Props {
  open: boolean;
  onClose(): void;
}

export const SearchModal = ({ open, onClose }: Props) => {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    if (open) {
      setSearchValue('');
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        const input = document.querySelector('.search-modal .search-input input') as HTMLInputElement;
        if (input) input.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="search-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="search-modal">
        <div className="search-modal-heading">
          <h2>搜尋遊戲或規則 <span className="search-modal-shortcut">⌘K</span></h2>
          <button type="button" onClick={onClose} aria-label="關閉">×</button>
        </div>
        <GameSearch
          value={searchValue}
          onChange={setSearchValue}
          includeRules={true}
          allowCreate={true}
          onCreate={(name) => {
            navigate(`/add?name=${encodeURIComponent(name)}`);
            onClose();
          }}
          onSelect={(game) => {
            navigate(`/games/${game.slug}`);
            onClose();
          }}
          onRuleSelect={(rule) => {
            navigate(`/games/${rule.gameSlug}?find=${encodeURIComponent(searchValue)}#rule-${rule.ruleId}`);
            onClose();
          }}
        />
      </div>
    </div>
  );
};
