/** One read attempt, including its response body; callers keep their cache/dedup rules. */
export const withReadTimeout = async <T,>(read: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await read(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally { clearTimeout(timer); }
};
