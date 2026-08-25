import { useState } from 'react';
import type { AttributeSubject } from '../shared/types';

interface AttributeGameCardProps {
  subject: AttributeSubject;
  side: 'left' | 'right';
  disabled?: boolean;
  selected?: boolean;
  onChoose: () => void;
}

export const AttributeGameCard = ({ subject, side, disabled = false, selected = false, onChoose }: AttributeGameCardProps) => {
  const [imageFailed, setImageFailed] = useState(false);
  const secondaryLine = [subject.secondaryName, subject.year ? `(${subject.year})` : undefined].filter(Boolean).join(' ');
  const hasThumbnail = Boolean(subject.thumbnailUrl && !imageFailed);

  return <button
    type="button"
    className={`attribute-game-card is-${side} ${selected ? 'is-selected' : ''}`}
    aria-label={`${subject.displayName}較高`}
    aria-pressed={selected}
    onClick={onChoose}
    disabled={disabled}
  >
    {hasThumbnail && <span className="attribute-game-card-media">
      <img src={subject.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
    </span>}
    <span className="attribute-game-card-copy">
      <h3>{subject.displayName}</h3>
      {secondaryLine && <p>{secondaryLine}</p>}
    </span>
  </button>;
};
