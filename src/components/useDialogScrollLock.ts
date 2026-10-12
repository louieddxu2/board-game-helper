import { useEffect } from 'react';

let locks = 0;
let originalOverflow = '';

/** Nested dialogs may close in any order, especially when navigation closes all. */
export const useDialogScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    if (locks++ === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (--locks === 0) document.body.style.overflow = originalOverflow;
    };
  }, [active]);
};
