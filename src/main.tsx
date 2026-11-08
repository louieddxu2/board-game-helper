import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { startPwaInstallTracking } from './lib/pwaInstall';
import { startTextInputSelection } from './lib/textInputSelection';
import { startMouseDragScroll } from './lib/mouseDragScroll';

startPwaInstallTracking();
startTextInputSelection();
startMouseDragScroll();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // A new build takes over at once without reloading this tab; it keeps its own build until it next loads.
    // Report that build so the worker keeps its shell until this tab closes.
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: 'shell-in-use', entry: new URL(import.meta.url).pathname });
    });
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      void registration.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    }).catch(() => undefined); // Offline launches use the already installed worker.
  });
}
