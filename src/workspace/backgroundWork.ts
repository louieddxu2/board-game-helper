/** Yield a paint before optional local work; cancellable during unmount/StrictMode replay. */
export const afterWorkspacePaint = (work: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => { timer = setTimeout(work, 0); });
  return () => {
    cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
};
