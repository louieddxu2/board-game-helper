import { useLayoutEffect, useRef, useState } from 'react';
import type { AttributeSubject } from '../shared/types';

interface AttributeGameCardProps {
  subject: AttributeSubject;
  side: 'left' | 'right';
  disabled?: boolean;
  selected?: boolean;
  suggested?: boolean;
  onChoose: () => void;
}

export const AttributeGameCard = ({ subject, side, disabled = false, selected = false, suggested = false, onChoose }: AttributeGameCardProps) => {
  const [imageFailed, setImageFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const secondaryLine = [subject.secondaryName, subject.year ? `(${subject.year})` : undefined].filter(Boolean).join(' ');
  const hasThumbnail = Boolean(subject.thumbnailUrl && !imageFailed);

  useLayoutEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    const fit = () => {
      if (!heading.clientWidth) return;
      let minimum = 12;
      let maximum = 21;
      for (let index = 0; index < 7; index += 1) {
        const candidate = (minimum + maximum) / 2;
        heading.style.fontSize = `${candidate}px`;
        if (heading.scrollWidth <= heading.clientWidth) minimum = candidate;
        else maximum = candidate;
      }
      heading.style.fontSize = `${Math.floor(minimum * 10) / 10}px`;
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    observer?.observe(heading);
    return () => observer?.disconnect();
  }, [hasThumbnail, subject.displayName]);

  return <button
    type="button"
    className={`attribute-game-card is-${side} ${selected ? 'is-selected' : ''} ${suggested ? 'is-suggested' : ''}`}
    aria-label={`${subject.displayName}較高`}
    aria-pressed={selected}
    onClick={onChoose}
    disabled={disabled}
  >
    {hasThumbnail && <span className="attribute-game-card-media">
      <img src={subject.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
    </span>}
    <span className="attribute-game-card-copy">
      <h3 ref={headingRef}>{subject.displayName}</h3>
      {secondaryLine && <p>{secondaryLine}</p>}
    </span>
  </button>;
};
