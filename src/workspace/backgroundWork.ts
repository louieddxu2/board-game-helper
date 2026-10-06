/** Yield a paint before optional local work; cancellable during unmount/StrictMode replay. */
export const afterWorkspacePaint = (work: () => void, whenIdle = false) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleCallback: number | undefined;
  const frame = requestAnimationFrame(() => { timer = setTimeout(() => {
    if (whenIdle && typeof window.requestIdleCallback === 'function') idleCallback = window.requestIdleCallback(work);
    else work();
  }, 0); });
  return () => {
    cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
  };
};
