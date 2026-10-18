/** Keep a long upload/download alive without retaining its table data. Server
 * expiry remains authoritative when browser background timers are suspended. */
export const withSnapshotLease = async <T>(
  renew: () => Promise<unknown>,
  action: (check: () => Promise<void>) => Promise<T>,
) => {
  let inFlight: Promise<void> | undefined;
  let failure: unknown;
  let failed = false;
  const timer = setInterval(() => {
    if (inFlight || failed) return;
    inFlight = Promise.resolve().then(renew).then(() => undefined, error => { failed = true; failure = error; })
      .finally(() => { inFlight = undefined; });
  }, 15 * 60_000);
  const check = async () => {
    await inFlight;
    if (failed) throw failure;
  };
  try { return await action(check); }
  finally { clearInterval(timer); await inFlight; }
};
