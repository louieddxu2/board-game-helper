import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { localDb } from '../lib/localDb';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';
import { GameSearch } from './GameSearch';
type RecentGame = {
  id: string;
  slug: string;
  displayName: string;
  englishName?: string;
};
interface Props {
  open: boolean;
  onClose(): void;
}
const focusableSelector = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href]:not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export const SearchModal = ({ open, onClose }: Props) => {
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [viewportHeight, setViewportHeight] = useState<number>();
  const [viewportTop, setViewportTop] = useState(0);
  const [bottomClearance, setBottomClearance] = useState(16);
  const releaseForNavigation = useWorkspaceBrowserBack({ active: open, onBack: onClose });
  useEffect(() => {
    if (!open)
      return;
    let active = true;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchValue('');
    setRecentGames([]);
    void localDb.recentGames()
      .then((games) => {
        if (active)
          setRecentGames(games);
      })
      .catch(() => {
        if (active)
          setRecentGames([]);
      });
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const height = Math.round(viewport?.height ?? window.innerHeight);
      const top = Math.round(viewport?.offsetTop ?? 0);
      const bottom = top + height;
      const toolbar = document.querySelector('.mobile-nav')?.getBoundingClientRect();
      const toolbarVisible = toolbar && toolbar.height > 0 && toolbar.top < bottom && toolbar.bottom > top;
      setViewportHeight(height);
      setViewportTop(top);
      setBottomClearance(toolbarVisible ? Math.ceil(bottom - Math.max(top, toolbar.top)) + 16 : 16);
    };
    updateViewport();
    viewport?.addEventListener('resize', updateViewport);
    viewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    const focusTimer = window.setTimeout(() => {
      modalRef.current?.querySelector<HTMLInputElement>('.search-input input')?.focus({ preventScroll: true });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(focusTimer);
      viewport?.removeEventListener('resize', updateViewport);
      viewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open)
    return null;
  const style = viewportHeight ? {
    '--search-modal-viewport-height': `${viewportHeight}px`,
    '--search-modal-viewport-top': `${viewportTop}px`,
    '--search-modal-bottom-clearance': `${bottomClearance}px`,
  } as CSSProperties : undefined;
  const navigateFromSearch = (target: string) => {
    releaseForNavigation(() => navigate(target));
  };
  const openGame = (game: RecentGame) => navigateFromSearch(`/games/${game.slug}`);
  const recents = recentGames.length ? <>
    <p className="search-modal-list-heading">近期瀏覽</p>
    {recentGames.map((game) => (<button className="search-modal-recent" type="button" key={game.id} onClick={() => openGame(game)}>
      <strong>{game.displayName}</strong>
      {game.englishName && <span>{game.englishName}</span>}
    </button>))}
  </> : <p className="search-modal-empty">輸入遊戲名稱，開始搜尋</p>;
  return <div className="search-modal-backdrop" style={style} onClick={(event) => {
    if (event.target === event.currentTarget)
      onClose();
  }} role="presentation">
    <div ref={modalRef} className="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-modal-title" onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab')
        return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (!focusable.length)
        return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }}>
      <div className="search-modal-heading"><h2 id="search-modal-title">搜尋遊戲或規則 <span className="search-modal-shortcut">⌘K</span></h2><button type="button" onClick={onClose} aria-label="關閉搜尋">×</button></div>
      <GameSearch
        value={searchValue} onChange={setSearchValue} includeRules allowCreate clearable inlineResults emptyResults={recents}
        onCreate={(name) => navigateFromSearch(`/add?name=${encodeURIComponent(name)}`)}
        onSelect={(game) => navigateFromSearch(`/games/${game.slug}`)}
        onRuleSelect={(rule) => navigateFromSearch(`/games/${rule.gameSlug}?find=${encodeURIComponent(searchValue)}#rule-${rule.ruleId}`)}
      />
    </div>
  </div>;
};
