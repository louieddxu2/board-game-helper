import { useLayoutEffect, useRef, useState } from 'react';

// Measure the actual wrapped text: the three sections share one line budget.
export const useRulePreview = (maxLines: number | undefined, contentKey: string) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !maxLines) return;
    let width = 0;
    const measure = () => {
      const sections = Array.from(body.children) as HTMLElement[];
      const paragraphs = sections.map(section => section.querySelector('p')!);
      // Restore all sections before measuring, including those hidden at a narrower width.
      sections.forEach(section => { section.style.removeProperty('display'); });
      paragraphs.forEach(paragraph => { paragraph.style.webkitLineClamp = 'unset'; });
      const lineCounts = paragraphs.map(paragraph => {
        const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight);
        return Math.max(1, Math.ceil((paragraph.getBoundingClientRect().height - 0.5) / lineHeight));
      });
      let remaining = maxLines;
      let clipped = false;
      sections.forEach((section, index) => {
        const lines = Math.min(lineCounts[index], remaining);
        paragraphs[index].style.webkitLineClamp = String(Math.max(1, lines));
        if (lines === 0) section.style.display = 'none';
        if (lines < lineCounts[index]) clipped = true;
        remaining -= lines;
      });
      width = body.getBoundingClientRect().width;
      setTruncated(clipped);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (body.getBoundingClientRect().width !== width) measure();
    });
    observer.observe(body);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [maxLines, contentKey]);

  return { bodyRef, truncated };
};
