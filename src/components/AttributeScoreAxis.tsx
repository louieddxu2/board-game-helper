import type { ReactNode, Ref } from 'react';

interface AttributeScoreAxisProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  stageRef?: Ref<HTMLDivElement>;
}

export const AttributeScoreAxis = ({ ariaLabel, children, className = '', stageRef }: AttributeScoreAxisProps) => <div className={`attribute-score-axis ${className}`.trim()} aria-label={ariaLabel}>
  <span className="attribute-score-axis-label" aria-hidden="true">0</span>
  <div className="attribute-score-axis-stage" ref={stageRef}>
    <span className="attribute-score-axis-rail" aria-hidden="true" />
    {children}
  </div>
  <span className="attribute-score-axis-label" aria-hidden="true">10</span>
</div>;
