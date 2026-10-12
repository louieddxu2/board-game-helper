import type { createBrowserRouter } from 'react-router-dom';
import { uiHistory } from './uiHistory';

/** Router PUSH/REPLACE must wait for asynchronous history cleanup to finish. */
export const connectUiHistoryRouter = (router: ReturnType<typeof createBrowserRouter>) => {
  const id = 'ui-history';
  router.getBlocker(id, ({ historyAction }) => historyAction !== 'POP' && uiHistory.hasLayers());
  const unsubscribe = router.subscribe(state => {
    const blocker = state.blockers.get(id);
    if (blocker?.state === 'blocked') uiHistory.navigate(() => blocker.proceed());
    uiHistory.observeRoute();
  });
  return () => {
    unsubscribe();
    router.deleteBlocker(id);
  };
};
