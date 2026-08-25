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

  return <article className={`attribute-game-card is-${side}`}>
    <div className="attribute-game-card-media">
      {subject.thumbnailUrl && !imageFailed
        ? <img src={subject.thumbnailUrl} alt="" onError={() => setImageFailed(true)} />
        : <span aria-hidden="true">封面</span>}
      <button type="button" className="attribute-game-card-refresh" aria-label={`換掉${subject.displayName}`} title={`換掉${subject.displayName}`} onClick={onRefresh} disabled={disabled}>↻</button>
    </div>
    <div className="attribute-game-card-copy">
      <span className="attribute-game-card-side">{side === 'left' ? '左' : '右'}</span>
      <h3>{subject.displayName}</h3>
      {secondaryLine && <p>{secondaryLine}</p>}
    </div>
  </article>;
};
