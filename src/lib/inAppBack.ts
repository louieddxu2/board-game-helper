export interface NavigateFunctionLike {
  (to: number): void;
  (to: string, options?: { replace?: boolean }): void;
}

/** Return to the previous in-app entry when one exists; direct links get a safe parent route. */
export const navigateBackOr = (navigate: NavigateFunctionLike, fallback: string) => {
  const historyState = typeof window === 'undefined' ? undefined : window.history.state as { idx?: unknown } | null;
  if (typeof historyState?.idx === 'number' && historyState.idx > 0) navigate(-1);
  else navigate(fallback, { replace: true });
};
