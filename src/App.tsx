import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { isInstalledPwa, isPwaHomeShortcut, pwaRouteToRestore, readPwaLastRoute, savePwaLastRoute } from './lib/pwaNavigation';
import { uiHistory } from './workspace/uiHistory';
import { isWorkspaceVirtualKeyboardOpen } from './workspace/useWorkspaceBrowserBack';
import { connectUiHistoryRouter } from './workspace/uiHistoryRouter';

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

const installedPwa = isInstalledPwa();
if (installedPwa) {
  const homeShortcut = isPwaHomeShortcut(window.location);
  const restoredRoute = homeShortcut ? '/' : pwaRouteToRestore(window.location.pathname, readPwaLastRoute());
  // Choose the entry before matching lazy routes, so resuming a table never loads the homepage first.
  if (restoredRoute) window.history.replaceState(window.history.state, '', restoredRoute);
}

uiHistory.install(isWorkspaceVirtualKeyboardOpen);
const router = createBrowserRouter([
  { path: '/workspace', lazy: async () => ({ Component: (await import('./pages/WorkspacePage')).WorkspacePage }), errorElement: <ErrorFallback />, HydrateFallback: LoadingFallback },
  { path: '/', lazy: async () => ({ Component: (await import('./components/SiteLayout')).SiteLayout }), errorElement: <ErrorFallback />, HydrateFallback: LoadingFallback, children: [
    { index: true, lazy: async () => ({ Component: (await import('./pages/HomePage')).HomePage }) },
    { path: 'add', lazy: async () => ({ Component: (await import('./pages/AddPage')).AddPage }) },
    { path: 'games/:identifier', lazy: async () => ({ Component: (await import('./pages/GamePage')).GamePage }) },
    { path: 'login', lazy: async () => ({ Component: (await import('./pages/AccountPage')).AccountPage }) },
    { path: 'account', lazy: async () => ({ Component: (await import('./pages/AccountPage')).AccountPage }) },
    { path: 'catalog', lazy: async () => ({ Component: (await import('./pages/CatalogPage')).CatalogPage }) },
    { path: 'attributes/table', lazy: async () => ({ Component: (await import('./pages/AttributeTablePage')).AttributeTablePage }) },
    { path: 'attributes', lazy: async () => ({ Component: (await import('./pages/AttributesPage')).AttributesPage }) },
    { path: 'contributions', lazy: async () => ({ Component: (await import('./pages/ContributionsPage')).ContributionsPage }) },
    { path: 'privacy', lazy: async () => ({ Component: (await import('./pages/PrivacyPage')).PrivacyPage }) },
    { path: 'review', lazy: async () => ({ Component: (await import('./pages/ReviewPage')).ReviewPage }) },
    { path: 'admin', lazy: async () => ({ Component: (await import('./pages/AdminPage')).AdminPage }) },
  ] },
]);

if (installedPwa) savePwaLastRoute(router.state.location);

connectUiHistoryRouter(router);
router.subscribe((state) => {
  savePwaLastRoute(state.location);
});

export const App = () => <ToastProvider><ConfirmProvider><RouterProvider router={router} /></ConfirmProvider></ToastProvider>;
