import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export const ScrollToTop = () => {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    // 1. 返回／前進交給瀏覽器恢復原位置
    if (navigationType === 'POP') return;

    // 2. 有錨點時，交給錨點定位
    if (location.hash) {
      requestAnimationFrame(() => {
        const elementId = decodeURIComponent(location.hash.slice(1));
        const element = document.getElementById(elementId);
        element?.scrollIntoView({ block: 'start' });
      });
      return;
    }

    // 3. 一般分頁切換（pathname 改變），捲動至頂部
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.hash, navigationType]);

  return null;
};
