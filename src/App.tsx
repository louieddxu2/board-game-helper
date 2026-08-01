import { createBrowserRouter, RouterProvider, useRouteError } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionProvider } from './context/SessionContext';
import { AddPage } from './pages/AddPage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage } from './pages/AccountPage';
import { CatalogPage } from './pages/CatalogPage';
import { GamePage } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ReviewPage } from './pages/ReviewPage';
import { ContributionsPage } from './pages/ContributionsPage';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';

const ErrorFallback = () => (
  <section className="narrow-page">
    <h1>頁面發生小意外</h1>
    <p>抱歉，載入頁面時發生預期以外的錯誤。請嘗試重新整理或回到首頁。<br />若仍無效果，請聯繫網頁管理員。</p>
    <div className="hero-actions">
      <button type="button" className="button primary" onClick={() => window.location.reload()}>重新載入</button>
      <a className="button secondary" href="/">回首頁</a>
    </div>
  </section>
);

const router = createBrowserRouter([
  { path: '/', element: <Layout />, errorElement: <ErrorFallback />, children: [
    { index: true, element: <HomePage /> },
    { path: 'add', element: <AddPage /> },
    { path: 'games/:identifier', element: <GamePage /> },
    { path: 'login', element: <AccountPage /> },
    { path: 'account', element: <AccountPage /> },
    { path: 'catalog', element: <CatalogPage /> },
    { path: 'contributions', element: <ContributionsPage /> },
    { path: 'privacy', element: <PrivacyPage /> },
    { path: 'review', element: <ReviewPage /> },
    { path: 'admin', element: <AdminPage /> },
  ] },
]);

export const App = () => <SessionProvider><ToastProvider><ConfirmProvider><RouterProvider router={router} /></ConfirmProvider></ToastProvider></SessionProvider>;
