import { useLayoutEffect, useRef, useState } from 'react';

// True when the title's text runs onto more than one line, so following chips can start a fresh row.
export const useWrappedTitle = <T extends HTMLElement>(text?: string) => {
  const ref = useRef<T>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // Measure text nodes only; the link's own 44px tap box would otherwise count as another line.
      const tops = new Set<number>();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        range.selectNodeContents(node);
        [...range.getClientRects()].filter((rect) => rect.width > 0).forEach((rect) => tops.add(Math.round(rect.top)));
      }
      setWrapped(tops.size > 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return [ref, wrapped] as const;
};
