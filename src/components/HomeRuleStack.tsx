import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function HomeRuleStack({ mobile, cards }: {
  mobile: boolean;
  cards: { id: string; href: string; label: string; content: ReactNode }[];
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const cardIds = cards.map(card => card.id).join(',');

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!mobile || !stack || typeof ResizeObserver === 'undefined') return;
    const entries = [...stack.children] as HTMLElement[];
    const measure = () => {
      const bottom = stack.getBoundingClientRect().bottom;
      for (const entry of entries) {
        const bounds = entry.getBoundingClientRect();
        const clipped = bounds.bottom > bottom + 0.5;
        const cue = entry.querySelector('.home-rule-title-link > span');
        const hidden = bounds.top >= bottom - 0.5
          || (entry !== entries[0] && !!cue && cue.getBoundingClientRect().bottom > bottom);
        const content = entry.firstElementChild as HTMLElement;
        const link = entry.lastElementChild as HTMLElement;
        entry.dataset.outsideStack = String(hidden);
        content.inert = clipped;
        link.hidden = !clipped || hidden;
        link.style.height = clipped ? `${Math.max(0, bottom - bounds.top)}px` : '';
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    entries.forEach(entry => observer.observe(entry));
    measure();
    return () => {
      observer.disconnect();
      for (const entry of entries) {
        delete entry.dataset.outsideStack;
        (entry.firstElementChild as HTMLElement).inert = false;
        (entry.lastElementChild as HTMLElement).hidden = true;
        (entry.lastElementChild as HTMLElement).style.height = '';
      }
    };
  }, [mobile, cardIds]);

  return <div className="home-rule-stack" ref={stackRef}>
    {cards.map(card => <div className="home-rule-stack-entry" key={card.id}>
      <div className="home-rule-stack-content">{card.content}</div>
      <Link className="home-rule-stack-link" hidden to={card.href} aria-label={card.label} />
    </div>)}
  </div>;
}
