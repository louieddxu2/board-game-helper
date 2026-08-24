import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionProvider } from './context/SessionContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { isInstalledPwa, isPwaHomeShortcut, pwaRouteToRestore, readPwaLastRoute, savePwaLastRoute } from './lib/pwaNavigation';

const LoadingFallback = () => (
  <section className="narrow-page workspace-loading">
    <p>載入中…</p>
  </section>
);

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
  { path: '/workspace', lazy: async () => ({ Component: (await import('./pages/WorkspacePage')).WorkspacePage }), errorElement: <ErrorFallback />, HydrateFallback: LoadingFallback },
  { path: '/', element: <SessionProvider><Layout /></SessionProvider>, errorElement: <ErrorFallback />, HydrateFallback: LoadingFallback, children: [
    { index: true, lazy: async () => ({ Component: (await import('./pages/HomePage')).HomePage }) },
    { path: 'add', lazy: async () => ({ Component: (await import('./pages/AddPage')).AddPage }) },
    { path: 'games/:identifier', lazy: async () => ({ Component: (await import('./pages/GamePage')).GamePage }) },
    { path: 'login', lazy: async () => ({ Component: (await import('./pages/AccountPage')).AccountPage }) },
    { path: 'account', lazy: async () => ({ Component: (await import('./pages/AccountPage')).AccountPage }) },
    { path: 'catalog', lazy: async () => ({ Component: (await import('./pages/CatalogPage')).CatalogPage }) },
    { path: 'attributes', lazy: async () => ({ Component: (await import('./pages/AttributesPage')).AttributesPage }) },
    { path: 'contributions', lazy: async () => ({ Component: (await import('./pages/ContributionsPage')).ContributionsPage }) },
    { path: 'privacy', lazy: async () => ({ Component: (await import('./pages/PrivacyPage')).PrivacyPage }) },
    { path: 'review', lazy: async () => ({ Component: (await import('./pages/ReviewPage')).ReviewPage }) },
    { path: 'admin', lazy: async () => ({ Component: (await import('./pages/AdminPage')).AdminPage }) },
  ] },
]);

const installedPwa = isInstalledPwa();
const launchedFromPwaHomeShortcut = installedPwa && typeof window !== 'undefined' && isPwaHomeShortcut({ pathname: window.location.pathname, search: window.location.search });
const shouldRestorePwaRoute = installedPwa && typeof window !== 'undefined' && pwaRouteToRestore(window.location.pathname, readPwaLastRoute(), launchedFromPwaHomeShortcut);
if (launchedFromPwaHomeShortcut) {
  void router.navigate('/', { replace: true });
} else if (shouldRestorePwaRoute) {
  void router.navigate(shouldRestorePwaRoute);
} else if (installedPwa) {
  savePwaLastRoute(router.state.location);
}

router.subscribe((state) => {
  savePwaLastRoute(state.location);
});

export const App = () => <ToastProvider><ConfirmProvider><RouterProvider router={router} /></ConfirmProvider></ToastProvider>;
