import { useLayoutEffect, useRef, useState } from 'react';

const OWN_ROW = 'rule-tags-own-row';

// True when the tags cannot all sit beside the game title, so they move together onto their own row
// instead of splitting between the title row and the next. Measured from the real chip widths, not their count.
export const useTagsOwnRow = <T extends HTMLElement>(titleRef: React.RefObject<HTMLElement | null>, key: string) => {
  const ref = useRef<T>(null);
  const [ownRow, setOwnRow] = useState(false);
  useLayoutEffect(() => {
    const tags = ref.current;
    const title = titleRef.current;
    const header = tags?.parentElement?.parentElement;
    if (!tags || !title || !header || typeof ResizeObserver === 'undefined') {
      setOwnRow(false);
      return;
    }
    const measure = () => {
      // Lay the chips out inline for this read only; the class is restored before the browser paints.
      const hadOwnRow = tags.classList.contains(OWN_ROW);
      tags.classList.remove(OWN_ROW);
      const titleTop = Math.round(title.getBoundingClientRect().top);
      const besideTitle = [...tags.children].every((chip) => Math.abs(Math.round(chip.getBoundingClientRect().top) - titleTop) <= 2);
      if (hadOwnRow) tags.classList.add(OWN_ROW);
      setOwnRow(!besideTitle);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [key, titleRef]);
  return [ref, ownRow] as const;
};
