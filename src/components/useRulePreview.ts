import { useLayoutEffect, useRef, useState } from 'react';

// Measure wrapped text against the shared budget and optional per-section mobile cap.
export const useRulePreview = (maxLines: number | undefined, contentKey: string, mobileLinesPerSection?: number) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !maxLines) return;
    const mobile = window.matchMedia('(max-width: 800px)');
    const probes = Array.from(body.querySelectorAll<HTMLElement>('.rule-preview-metrics'));
    const dimensions = () => [body.getBoundingClientRect().width, ...probes.flatMap(probe => {
      const box = probe.getBoundingClientRect();
      return [box.width, box.height];
    })].join(',');
    let measuredDimensions = '';
    let frame = 0;
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
      const sectionLimit = mobile.matches ? mobileLinesPerSection ?? maxLines : maxLines;
      let clipped = false;
      sections.forEach((section, index) => {
        const lines = Math.min(lineCounts[index], remaining, sectionLimit);
        paragraphs[index].style.webkitLineClamp = String(Math.max(1, lines));
        if (lines === 0) section.style.display = 'none';
        if (lines < lineCounts[index]) clipped = true;
        remaining -= lines;
      });
      measuredDimensions = dimensions();
      setTruncated(clipped);
    };
    measure();
    const observer = new ResizeObserver(() => {
      // Font size/line height may change without changing the card width or clamped height.
      if (dimensions() === measuredDimensions) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(body);
    probes.forEach(probe => observer.observe(probe));
    mobile.addEventListener('change', measure);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      mobile.removeEventListener('change', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [maxLines, contentKey, mobileLinesPerSection]);

  return { bodyRef, truncated };
};
