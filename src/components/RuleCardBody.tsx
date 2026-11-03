import type { RuleCard } from '../shared/types';
import zhTWCopy from '../content/zh-TW.json';
import { useRulePreview } from './useRulePreview';

type TextToggleProps = React.HTMLAttributes<HTMLParagraphElement>;

export const RuleCardBody = ({ rule, previewLines, toggleProps = {} }: {
  rule: RuleCard;
  previewLines?: number;
  toggleProps?: TextToggleProps;
}) => {
  const { bodyRef, truncated } = useRulePreview(previewLines, JSON.stringify([rule.statement, rule.commonMistake, rule.details]));
  const textClass = toggleProps.onClick ? ' rule-toggle-text' : '';
  const content = <>
    <div className="rule-statement-section">
      <p className={`statement-text${textClass}`} {...toggleProps}>{rule.statement}</p>
    </div>
    {rule.commonMistake && <div className="mistake">
      <strong className="mistake-badge"><span>{zhTWCopy.terms.mistakeSituation.slice(0, 2)}<br />{zhTWCopy.terms.mistakeSituation.slice(2)}</span></strong>
      <p className={`mistake-text${textClass}`} {...toggleProps}>{rule.commonMistake}</p>
    </div>}
    {rule.details && <div className="rule-details-note">
      <strong className="details-badge"><span>補充<br />說明</span></strong>
      <p className={`details-text${textClass}`} {...toggleProps}>{rule.details}</p>
    </div>}
  </>;

  if (!previewLines) return content;
  return <>
    <div className="rule-card-preview" ref={bodyRef}>{content}</div>
    {truncated && <small className="rule-card-preview-hint">內容未完，點按卡片查看完整規則</small>}
  </>;
};
