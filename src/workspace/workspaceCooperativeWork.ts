/** Drain the same validation/normalization steps for synchronous compatibility callers. */
export const finishWorkspaceSteps = <T>(steps: Generator<void, T>): T => {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

/** A new browser task lets input and rendering run, including when idle work is withheld. */
export const yieldWorkspaceTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export const runWorkspaceCooperativeSteps = async <T>(steps: Generator<void, T>, checkCurrent: () => void): Promise<T> => {
  let started = performance.now();
  for (;;) {
    checkCurrent();
    const step = steps.next();
    if (step.done) return step.value;
    if (performance.now() - started >= 3) {
      await yieldWorkspaceTask();
      checkCurrent();
      started = performance.now();
    }
  }
};
