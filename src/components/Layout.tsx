import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { localDb } from '../lib/localDb';
import { SearchModal } from './SearchModal';
import { ScrollToTop } from './ScrollToTop';

const mockLabels: Record<string, string> = {
  unauthenticated: '未登入',
  user: '一般使用者',
  editor: 'Editor',
  admin: 'Admin',
};

const FaintRedLock = () => (
  <svg className="faint-red-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <title>登入後可有限地記錄</title>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

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
      <main id="main-content"><Outlet context={{ setHeaderAction }} /></main>
    </div>;
  }

  return <div className={isAddFormPage ? 'app-shell is-add-page' : 'app-shell'}>
    <ScrollToTop />
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <header className="site-header">
      <NavLink to="/" className="brand" aria-label="玩錯的桌遊規則首頁">
        <span className="brand-mark">✓</span>
        <strong>玩錯的桌遊規則</strong>
      </NavLink>
      {headerAction && <div className="site-header-action">{headerAction}</div>}
      <nav className="desktop-nav" aria-label="主要導覽">
        <button type="button" className="link-button" onClick={() => setSearchOpen(true)}>搜尋</button>
        <NavLink to={addRuleHref} className="nav-primary">＋記錄{!user && <FaintRedLock />}</NavLink>
        {isAdmin && <NavLink to="/review">校稿</NavLink>}
        {user && <NavLink to="/catalog">列表</NavLink>}
        {realIsAdmin && <NavLink to="/admin" style={mockRole ? { outline: '2px solid var(--accent, #e53935)', borderRadius: '4px' } : undefined}>{adminLabel}</NavLink>}
        <NavLink to={user ? '/account' : '/login'}>{user ? '帳號' : '登入'}</NavLink>
      </nav>
    </header>
    <main id="main-content"><Outlet context={{ setHeaderAction }} /></main>
    {!isAddFormPage && <nav className="mobile-nav" aria-label="手機主要導覽">
      <button type="button" onClick={() => setSearchOpen(true)}><span aria-hidden="true"><NavIcon name="search" /></span><small>搜尋</small></button>
      <NavLink to={addRuleHref} className={currentGameIdentifier ? 'mobile-primary game-page-primary' : 'mobile-primary'}><span aria-hidden="true"><NavIcon name="add" />{!user && <FaintRedLock />}</span><small>記錄{user && pendingCount ? `・待送 ${pendingCount}` : ''}</small></NavLink>
      {isAdmin && <NavLink to="/review"><span aria-hidden="true"><NavIcon name="review" /></span><small>校稿</small></NavLink>}
      {user && <NavLink to="/catalog"><span aria-hidden="true"><NavIcon name="list" /></span><small>列表</small></NavLink>}
      {realIsAdmin && <NavLink to="/admin"><span aria-hidden="true"><NavIcon name="admin" /></span><small>{adminLabel}</small></NavLink>}
      <NavLink to={user ? '/account' : '/login'}><span aria-hidden="true"><NavIcon name="account" /></span><small>{user ? '帳號' : '登入'}</small></NavLink>
    </nav>}
    <footer>
      <span>把踩過的坑，化為下次的提醒。</span>
      <NavLink to="/privacy">隱私與資料</NavLink>
    </footer>
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
};
