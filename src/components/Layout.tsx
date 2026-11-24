import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { useSiteMode } from '../hooks/useSiteMode';
import { localDb } from '../lib/localDb';
import { requestUncertainRuleAdd, SITE_MARKS, SITE_TITLES } from '../lib/siteMode';
import { SearchModal } from './SearchModal';
import { HomeStats } from './HomeStats';
import { ScrollToTop } from './ScrollToTop';
import { WriteBudgetNotice } from './WriteBudgetNotice';

const mockLabels: Record<string, string> = {
  unauthenticated: '未登入',
  user: '一般使用者',
  editor: 'Editor',
  admin: 'Admin',
};


const navIconPaths = {
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  add: <path d="M12 5v14M5 12h14" />,
  review: <><path d="M5 4h10l4 4v12H5Z" /><path d="m9 14 2 2 4-4" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  admin: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" /></>,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" /></>,
};

const NavIcon = ({ name }: { name: keyof typeof navIconPaths }) => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {navIconPaths[name]}
  </svg>
);

export const Layout = () => {
  const location = useLocation();
  const { user, canEdit, isAdmin, realIsAdmin, mockRole, logout } = useSession();
  const [pendingCount, setPendingCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const isAddFormPage = location.pathname === '/add' && Boolean(user);
  const gamePathMatch = location.pathname.match(/^\/games\/([^/]+)$/);
  const currentGameIdentifier = gamePathMatch ? decodeURIComponent(gamePathMatch[1]) : undefined;
  const addRuleHref = currentGameIdentifier ? `/add?game=${encodeURIComponent(currentGameIdentifier)}` : '/add';
  const { mode, canSwitch, setMode } = useSiteMode();
  const otherMode = mode === 'wrong' ? 'uncertain' : 'wrong';
  // On a game page in the uncertain mode, 記錄 notes an uncertain rule instead of a wrong one.
  const addsUncertainRule = mode === 'uncertain' && Boolean(currentGameIdentifier);

  useEffect(() => {
    let active = true;
    const refreshPendingCount = () => {
      if (!user) { setPendingCount(0); return; }
      void localDb.getPending(user.id).then((pending) => {
        if (active) setPendingCount(pending.reduce((total, item) => total + item.payload.rules.length, 0));
      });
    };
    refreshPendingCount();
    window.addEventListener('rules-pending-change', refreshPendingCount);
    return () => { active = false; window.removeEventListener('rules-pending-change', refreshPendingCount); };
  }, [user?.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [headerAction, setHeaderAction] = useState<React.ReactNode>(null);
  const adminLabel = mockRole ? `管理 (${mockLabels[mockRole] || mockRole})` : '管理';

  if (location.pathname === '/attributes' || location.pathname === '/attributes/table') {
    return <div className="attribute-app-shell">
      <ScrollToTop />
      <WriteBudgetNotice />
      <main id="main-content"><Outlet context={{ setHeaderAction }} /></main>
    </div>;
  }

  return <div className={isAddFormPage ? 'app-shell is-add-page' : 'app-shell'}>
    <ScrollToTop />
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <header className="site-header">
      <div className={`brand-row site-mode-${mode}`}>
        <NavLink to="/" className="brand" aria-label={`${SITE_TITLES[mode]}首頁`}>
          <span className="brand-mark">{SITE_MARKS[mode]}</span>
          <strong>{SITE_TITLES[mode]}</strong>
        </NavLink>
        {canSwitch && <button type="button" className="site-mode-switch" aria-label={`切換到${SITE_TITLES[otherMode]}`} title={`切換到${SITE_TITLES[otherMode]}`} onClick={() => setMode(otherMode)}>⇄{SITE_MARKS[otherMode]}</button>}
      </div>
      {headerAction && <div className="site-header-action">{headerAction}</div>}
      <nav className="desktop-nav" aria-label="主要導覽">
        <button type="button" className="link-button" onClick={() => setSearchOpen(true)}>搜尋</button>
        {addsUncertainRule ? <button type="button" className="link-button nav-primary" onClick={requestUncertainRuleAdd}>＋記錄</button> : <NavLink to={addRuleHref} className={user ? 'nav-primary' : undefined}>＋記錄</NavLink>}
        {isAdmin && <NavLink to="/review">校稿</NavLink>}
        <NavLink to="/catalog">列表</NavLink>
        {realIsAdmin && <NavLink to="/admin" style={mockRole ? { outline: '2px solid var(--accent, #e53935)', borderRadius: '4px' } : undefined}>{adminLabel}</NavLink>}
        <NavLink to={user ? '/account' : '/login'}>{user ? '帳號' : '登入'}</NavLink>
      </nav>
    </header>
    <WriteBudgetNotice />
    <main id="main-content"><Outlet context={{ setHeaderAction }} /></main>
    {!isAddFormPage && <nav className="mobile-nav" aria-label="手機主要導覽">
      <button type="button" onClick={() => setSearchOpen(true)}><span aria-hidden="true"><NavIcon name="search" /></span><small>搜尋</small></button>
      {addsUncertainRule
        ? <button type="button" className="mobile-primary" onClick={requestUncertainRuleAdd}><span aria-hidden="true"><NavIcon name="add" /></span><small>記錄</small></button>
        : <NavLink to={addRuleHref} className={user ? 'mobile-primary' : undefined}><span aria-hidden="true"><NavIcon name="add" /></span><small>記錄{user && pendingCount ? `・待送 ${pendingCount}` : ''}</small></NavLink>}
      {isAdmin && <NavLink to="/review"><span aria-hidden="true"><NavIcon name="review" /></span><small>校稿</small></NavLink>}
      <NavLink to="/catalog"><span aria-hidden="true"><NavIcon name="list" /></span><small>列表</small></NavLink>
      {realIsAdmin && <NavLink to="/admin"><span aria-hidden="true"><NavIcon name="admin" /></span><small>{adminLabel}</small></NavLink>}
      <NavLink to={user ? '/account' : '/login'}><span aria-hidden="true"><NavIcon name="account" /></span><small>{user ? '帳號' : '登入'}</small></NavLink>
    </nav>}
    <footer>
      {location.pathname === '/' && <HomeStats />}
      <span>把踩過的坑，化為下次的提醒。</span>
      <NavLink to="/privacy">隱私與資料</NavLink>
    </footer>
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
};
