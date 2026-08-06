import { useRef } from 'react';
import { formatPlayerCounts, normalizePlayerCounts } from '../lib/playerCounts';

interface PlayerCountInputProps {
  value: number[];
  onChange(value: number[]): void;
  label?: string;
  disabled?: boolean;
}

interface PaintState {
  pointerId: number;
  selected: boolean;
  startCount: number;
  startX: number;
  startY: number;
  phase: 'pending' | 'painting';
  visited: Set<number>;
  counts: Set<number>;
}

const PLAYER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const PAINT_INTENT_THRESHOLD = 8;

export const PlayerCountInput = ({ value, onChange, label = '適用人數', disabled = false }: PlayerCountInputProps) => {
  const paintState = useRef<PaintState | undefined>(undefined);
  const lastPointerAction = useRef<'tap' | 'paint' | 'cancelled' | undefined>(undefined);
  const normalized = normalizePlayerCounts(value);

  const toggle = (count: number) => {
    onChange(normalizePlayerCounts(normalized.includes(count) ? value.filter((item) => item !== count) : [...value, count]));
  };

  const paint = (state: PaintState, count: number) => {
    if (state.selected) state.counts.add(count);
    else state.counts.delete(count);
    onChange(normalizePlayerCounts([...state.counts]));
  };

  const countFromElement = (element: Element | null) => {
    const target = element?.closest<HTMLElement>('[data-player-count]');
    const count = Number(target?.dataset.playerCount);
    return PLAYER_COUNTS.includes(count as typeof PLAYER_COUNTS[number]) ? count : undefined;
  };

  const countAtPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    return countFromElement(element);
  };

  return <fieldset className="player-count-input">
    <legend>{label}</legend>
    <div className="player-count-track"
      onPointerDown={(event) => {
        if (disabled) return;
        const count = countFromElement(event.target as Element);
        if (!count) return;
        lastPointerAction.current = undefined;
        paintState.current = {
          pointerId: event.pointerId,
          selected: !normalized.includes(count),
          startCount: count,
          startX: event.clientX,
          startY: event.clientY,
          phase: 'pending',
          visited: new Set([count]),
          counts: new Set(normalized),
        };
      }}
      onPointerMove={(event) => {
        const state = paintState.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (state.phase === 'pending') {
          const deltaX = event.clientX - state.startX;
          const deltaY = event.clientY - state.startY;
          if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < PAINT_INTENT_THRESHOLD) return;
          if (Math.abs(deltaY) >= Math.abs(deltaX)) {
            paintState.current = undefined;
            lastPointerAction.current = 'cancelled';
            return;
          }
          state.phase = 'painting';
          lastPointerAction.current = 'paint';
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          paint(state, state.startCount);
        }
        if (state.phase !== 'painting') return;
        event.preventDefault();
        const count = countAtPoint(event.clientX, event.clientY);
        if (!count || state.visited.has(count)) return;
        state.visited.add(count);
        paint(state, count);
      }}
      onPointerUp={(event) => {
        const state = paintState.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (state.phase === 'pending') {
          toggle(state.startCount);
          lastPointerAction.current = 'tap';
        } else {
          lastPointerAction.current = 'paint';
        }
        paintState.current = undefined;
      }}
      onPointerCancel={() => {
        if (paintState.current) lastPointerAction.current = 'cancelled';
        paintState.current = undefined;
      }}>
      {PLAYER_COUNTS.map((count) => <button type="button" key={count} data-player-count={count}
        disabled={disabled}
        className={normalized.includes(count) ? 'selected' : ''} aria-pressed={normalized.includes(count)}
        aria-label={`${count} 人`} onClick={(event) => {
          if (lastPointerAction.current && event.detail > 0) {
            lastPointerAction.current = undefined;
            return;
          }
          lastPointerAction.current = undefined;
          toggle(count);
        }}>{count}</button>)}
    </div>
    <output aria-live="polite">{normalized.length ? formatPlayerCounts(normalized) : '未指定人數'}</output>
  </fieldset>;
};
