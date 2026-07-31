import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
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
    <title>需要申請編輯權限</title>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const Layout = () => {
  const { user, canEdit, isAdmin, realIsAdmin, mockRole, logout } = useSession();
  const [pendingCount, setPendingCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const refresh = () => void localDb.getPending().then((items) => setPendingCount(items.length));
    refresh(); window.addEventListener('rules-pending-change', refresh);
    return () => window.removeEventListener('rules-pending-change', refresh);
  }, []);

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

  return <div className="app-shell">
    <ScrollToTop />
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <header className="site-header">
      <NavLink to="/" className="brand" aria-label="玩錯的桌遊規則首頁">
        <span className="brand-mark">✓</span>
        <span><strong>玩錯的桌遊規則</strong><small>這次玩對，或是下次玩對。</small></span>
      </NavLink>
      {headerAction && <div className="site-header-action">{headerAction}</div>}
      <nav className="desktop-nav" aria-label="主要導覽">
        <NavLink to="/">探索</NavLink>
        <NavLink to="/add" className="nav-primary">＋記錄{!canEdit && <FaintRedLock />}</NavLink>
        {isAdmin && <NavLink to="/review">校稿</NavLink>}
        {user && <NavLink to="/catalog">列表</NavLink>}
        {realIsAdmin && <NavLink to="/admin" style={mockRole ? { outline: '2px solid var(--accent, #e53935)', borderRadius: '4px' } : undefined}>{adminLabel}</NavLink>}
        <NavLink to={user ? '/account' : '/login'}>{user ? '帳號' : '登入'}</NavLink>
      </nav>
    </header>
    <main id="main-content"><Outlet context={{ setHeaderAction }} /></main>
    <nav className="mobile-nav" aria-label="手機主要導覽">
      <NavLink to="/" end><span aria-hidden="true">⌂</span><small>探索</small></NavLink>
      <button type="button" onClick={() => setSearchOpen(true)}><span aria-hidden="true">⌕</span><small>搜尋</small></button>
      <NavLink to="/add" className="mobile-primary"><span aria-hidden="true">＋{!canEdit && <FaintRedLock />}</span><small>記錄{canEdit && pendingCount ? `・待送 ${pendingCount}` : ''}</small></NavLink>
      {isAdmin && <NavLink to="/review"><span aria-hidden="true">校</span><small>校稿</small></NavLink>}
      {user && <NavLink to="/catalog"><span aria-hidden="true">列</span><small>列表</small></NavLink>}
      {realIsAdmin && <NavLink to="/admin"><span aria-hidden="true">◎</span><small>{adminLabel}</small></NavLink>}
      <NavLink to={user ? '/account' : '/login'}><span aria-hidden="true">◎</span><small>{user ? '帳號' : '登入'}</small></NavLink>
    </nav>
    <footer>
      <span>把踩過的坑，化為下次的提醒。</span>
      <NavLink to="/privacy">隱私與資料</NavLink>
    </footer>
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
};
