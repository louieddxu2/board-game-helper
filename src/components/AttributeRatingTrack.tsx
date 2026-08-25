import type { AttributeSubject } from '../shared/types';

interface AttributeRatingTrackProps {
  subject: AttributeSubject;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}

export const AttributeRatingTrack = ({ subject, value, disabled = false, onChange, onClear }: AttributeRatingTrackProps) => {
  const score = value === '' ? 5 : Number(value);
  const edgeClass = value !== '' && score <= 1 ? 'is-start' : value !== '' && score >= 9 ? 'is-end' : '';

  return <div className="attribute-rating-track">
    <div className="attribute-rating-track-heading">
      <span title={subject.displayName}>{subject.displayName}</span>
      <output>{value === '' ? '未設定' : `${value} 分`}</output>
    </div>
    <div className="attribute-rating-line">
      {value !== '' && <span className={`attribute-rating-marker ${edgeClass}`} style={{ left: `${score * 10}%` }}>
        <span>{subject.displayName} · {value}</span>
        <button type="button" aria-label={`取消${subject.displayName}評分`} title="取消評分" onClick={onClear} disabled={disabled}>×</button>
      </span>}
      <input aria-label={`評分：${subject.displayName}`} type="range" min="0" max="10" step="1" value={score} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-valuetext={value === '' ? '未設定，目前位置 5 分' : `${value} 分`} />
    </div>
    <div className="attribute-rating-scale" aria-hidden="true"><span>0</span><span>5</span><span>10</span></div>
  </div>;
};
