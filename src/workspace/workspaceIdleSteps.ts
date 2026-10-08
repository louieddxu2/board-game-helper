export interface WorkspaceIdleOptions {
  signal: AbortSignal;
  isCurrent: () => boolean;
  canRun: () => boolean;
}

/** Optional work has no forced idle deadline and yields after a small CPU budget. */
export const runWorkspaceIdleSteps = <T>(steps: Generator<void, T>, options: WorkspaceIdleOptions): Promise<T | undefined> => new Promise((resolve, reject) => {
  let timer: ReturnType<typeof setTimeout> | undefined, frame: number | undefined, idle: number | undefined;
  let finished = false;
  const cleanup = () => {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    options.signal.removeEventListener('abort', cancel);
  };
  const cancel = () => { cleanup(); resolve(undefined); };
  const schedule = () => {
    if (finished) return;
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run);
    else frame = requestAnimationFrame(() => { frame = undefined; timer = setTimeout(() => run(), 0); });
  };
  const run = (deadline?: IdleDeadline) => {
    timer = frame = idle = undefined;
    if (options.signal.aborted || !options.isCurrent()) { cancel(); return; }
    if (!options.canRun()) { timer = setTimeout(schedule, 150); return; }
    const start = performance.now();
    try {
      while (!deadline || deadline.timeRemaining() > 0) {
        const step = steps.next();
        if (step.done) { cleanup(); resolve(step.value); return; }
        if (performance.now() - start >= 3) break;
      }
      schedule();
    } catch (error) { cleanup(); reject(error); }
  };
  if (options.signal.aborted || !options.isCurrent()) { cancel(); return; }
  options.signal.addEventListener('abort', cancel, { once: true });
  schedule();
});
