import type { KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';
import type { AttributeSubject } from '../shared/types';
import { AttributeScoreAxis } from './AttributeScoreAxis';
import { useClampedAxisMarker } from './useClampedAxisMarker';

interface AttributeRatingTrackProps {
  leftSubject: AttributeSubject;
  rightSubject: AttributeSubject;
  leftValue: string;
  rightValue: string;
  disabled?: boolean;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
  onLeftClear: () => void;
  onRightClear: () => void;
}

type RatingSide = 'left' | 'right';

const scoreOf = (value: string) => value === '' ? 5 : Number(value);

export const AttributeRatingTrack = ({ leftSubject, rightSubject, leftValue, rightValue, disabled = false, onLeftChange, onRightChange, onLeftClear, onRightClear }: AttributeRatingTrackProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const leftMarkerRef = useClampedAxisMarker<HTMLDivElement>(scoreOf(leftValue), `${leftSubject.id}:${leftSubject.displayName}:${leftValue}`);
  const rightMarkerRef = useClampedAxisMarker<HTMLDivElement>(scoreOf(rightValue), `${rightSubject.id}:${rightSubject.displayName}:${rightValue}`);

  const setScoreFromPointer = (side: RatingSide, event: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const score = Math.max(0, Math.min(10, Math.round(((event.clientX - rect.left) / rect.width) * 10)));
    if (side === 'left') onLeftChange(String(score));
    else onRightChange(String(score));
  };

  const handlePointerDown = (side: RatingSide) => (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScoreFromPointer(side, event);
  };

  const handlePointerMove = (side: RatingSide) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) setScoreFromPointer(side, event);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleKeyDown = (side: RatingSide, value: string) => (event: KeyboardEvent<HTMLDivElement>) => {
    const current = scoreOf(value);
    const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - 1
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + 1
        : event.key === 'Home' ? 0
          : event.key === 'End' ? 10
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const score = Math.max(0, Math.min(10, next));
    if (side === 'left') onLeftChange(String(score));
    else onRightChange(String(score));
  };

  const renderMarker = (side: RatingSide, subject: AttributeSubject, value: string, onClear: () => void) => {
    const score = scoreOf(value);
    return <div
      ref={side === 'left' ? leftMarkerRef : rightMarkerRef}
      className={`attribute-rating-marker is-${side}`}
      style={{ left: `${score * 10}%` }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={`評分：${subject.displayName}`}
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={score}
      aria-valuetext={value === '' ? '未設定，目前位置 5 分' : `${value} 分`}
      onKeyDown={handleKeyDown(side, value)}
      onPointerDown={handlePointerDown(side)}
      onPointerMove={handlePointerMove(side)}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <span>{subject.displayName}{value === '' ? '' : ` · ${value}`}</span>
      {value !== '' && <button type="button" aria-label={`取消${subject.displayName}評分`} title="取消評分" onPointerDown={(event) => event.stopPropagation()} onClick={onClear} disabled={disabled}>×</button>}
    </div>;
  };

  return <div className="attribute-rating-track">
    <AttributeScoreAxis ariaLabel="兩款遊戲評分數線" stageRef={trackRef}>
      {renderMarker('left', leftSubject, leftValue, onLeftClear)}
      {renderMarker('right', rightSubject, rightValue, onRightClear)}
    </AttributeScoreAxis>
  </div>;
};
