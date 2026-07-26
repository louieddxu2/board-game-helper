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
  const { user, canEdit, realIsAdmin, mockRole, logout } = useSession();
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

  const adminLabel = mockRole ? `管理 (${mockLabels[mockRole] || mockRole})` : '管理';

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <header className="site-header">
      <NavLink to="/" className="brand" aria-label="玩錯的桌遊規則首頁">
        <span className="brand-mark">✓</span>
        <span><strong>玩錯的桌遊規則</strong><small>這次玩對，或是下次玩對。</small></span>
      </NavLink>
      <nav className="desktop-nav" aria-label="主要導覽">
        <NavLink to="/">探索</NavLink>
        {canEdit && <NavLink to="/add" className="nav-primary">＋記錄</NavLink>}
        {canEdit && <NavLink to="/review">校稿</NavLink>}
        {realIsAdmin && <NavLink to="/admin" style={mockRole ? { outline: '2px solid var(--accent, #e53935)', borderRadius: '4px' } : undefined}>{adminLabel}</NavLink>}
        {!user && <NavLink to="/login">登入</NavLink>}
        {user && <button type="button" className="link-button" onClick={() => void logout()}>登出</button>}
      </nav>
    </header>
    <main id="main-content"><Outlet /></main>
    <nav className="mobile-nav" aria-label="手機主要導覽">
      <NavLink to="/" end><span aria-hidden="true">⌂</span><small>探索</small></NavLink>
      <button type="button" onClick={() => setSearchOpen(true)}><span aria-hidden="true">⌕</span><small>搜尋</small></button>
      {canEdit && <NavLink to="/add" className="mobile-primary"><span aria-hidden="true">＋</span><small>記錄{pendingCount ? `・待送 ${pendingCount}` : ''}</small></NavLink>}
      {canEdit && <NavLink to="/review"><span aria-hidden="true">校</span><small>校稿</small></NavLink>}
      {realIsAdmin && <NavLink to="/admin"><span aria-hidden="true">◎</span><small>{adminLabel}</small></NavLink>}
    </nav>
    <footer>
      <span>把踩過的坑，留給下一次更好的開桌。</span>
      <NavLink to="/privacy">隱私與資料</NavLink>
    </footer>
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
};
