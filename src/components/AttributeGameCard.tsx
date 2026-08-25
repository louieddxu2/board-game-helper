import { useState } from 'react';
import type { AttributeSubject } from '../shared/types';

interface AttributeGameCardProps {
  subject: AttributeSubject;
  side: 'left' | 'right';
  disabled?: boolean;
  onRefresh: () => void;
}

export const AttributeGameCard = ({ subject, side, disabled = false, onRefresh }: AttributeGameCardProps) => {
  const [imageFailed, setImageFailed] = useState(false);
  const secondaryLine = [subject.secondaryName, subject.year ? `(${subject.year})` : undefined].filter(Boolean).join(' ');
  const hasThumbnail = Boolean(subject.thumbnailUrl && !imageFailed);

  return <article className={`attribute-game-card is-${side}`}>
    {hasThumbnail && <div className="attribute-game-card-media">
      <img src={subject.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
      <button type="button" className="attribute-game-card-refresh" aria-label={`換掉${subject.displayName}`} title={`換掉${subject.displayName}`} onClick={onRefresh} disabled={disabled}>↻</button>
    </div>}
    {!hasThumbnail && <button type="button" className="attribute-game-card-refresh attribute-game-card-refresh-inline" aria-label={`換掉${subject.displayName}`} title={`換掉${subject.displayName}`} onClick={onRefresh} disabled={disabled}>↻</button>}
    <div className="attribute-game-card-copy">
      <span className="attribute-game-card-side">{side === 'left' ? '左' : '右'}</span>
      <h3>{subject.displayName}</h3>
      {secondaryLine && <p>{secondaryLine}</p>}
    </div>
  </article>;
};
