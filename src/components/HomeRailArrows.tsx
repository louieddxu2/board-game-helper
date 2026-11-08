// Wider screens show arrows beside the featured rail as a visible cue that it moves; dragging and swiping still work.
export const HomeRailArrows = ({ canPrev, canNext, onPrev, onNext }: {
  canPrev: boolean;
  canNext: boolean;
  onPrev(): void;
  onNext(): void;
}) => <>
  <button type="button" className="home-rail-arrow prev" aria-label="上一個遊戲" hidden={!canPrev} onClick={onPrev}><span aria-hidden="true">‹</span></button>
  <button type="button" className="home-rail-arrow next" aria-label="下一個遊戲" hidden={!canNext} onClick={onNext}><span aria-hidden="true">›</span></button>
</>;
