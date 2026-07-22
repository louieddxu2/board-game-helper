import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

export const Layout = () => {
  const { user, canEdit, isAdmin, logout } = useSession();
  return <div className="app-shell">
    <header className="site-header">
      <NavLink to="/" className="brand" aria-label="玩錯的桌遊規則首頁">
        <span className="brand-mark">✓</span>
        <span><strong>玩錯的桌遊規則</strong><small>這次玩對，或是下次玩對。</small></span>
      </NavLink>
      <nav aria-label="主要導覽">
        <NavLink to="/">探索</NavLink>
        {canEdit && <NavLink to="/add" className="nav-primary">＋記錄</NavLink>}
        {isAdmin && <NavLink to="/admin">管理</NavLink>}
        {!user && <NavLink to="/login">登入</NavLink>}
        {user && <button type="button" className="link-button" onClick={() => void logout()}>登出</button>}
      </nav>
    </header>
    <main><Outlet /></main>
    <footer>把踩過的坑，留給下一次更好的開桌。</footer>
  </div>;
};

