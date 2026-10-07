import { useCallback, useLayoutEffect, useRef } from 'react';

/** For event handlers: keep identity stable and invoke the latest committed callback. */
export const useStableCallback = <Args extends unknown[], Result>(callback: (...args: Args) => Result) => {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
};
