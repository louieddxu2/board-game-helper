import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { localDb } from '../lib/localDb';
import { SearchModal } from './SearchModal';

const mockLabels: Record<string, string> = {
  unauthenticated: '未登入',
  user: '一般使用者',
  editor: 'Editor',
  admin: 'Admin',
};

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
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <header className="site-header">
      <NavLink to="/" className="brand" aria-label="玩錯的桌遊規則首頁">
        <span className="brand-mark">✓</span>
        <span><strong>玩錯的桌遊規則</strong><small>這次玩對，或是下次玩對。</small></span>
      </NavLink>
      {headerAction && <div className="site-header-action">{headerAction}</div>}
      <nav className="desktop-nav" aria-label="主要導覽">
        <NavLink to="/">探索</NavLink>
        <NavLink to="/add" className="nav-primary">＋記錄</NavLink>
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
      <NavLink to="/add" className="mobile-primary"><span aria-hidden="true">＋</span><small>記錄{pendingCount ? `・待送 ${pendingCount}` : ''}</small></NavLink>
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
