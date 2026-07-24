import { useState } from 'react';
import type { RuleCard as RuleCardType } from '../shared/types';
import { Link } from 'react-router-dom';

const stageNames: Record<string, string> = {
  setup: '設置', round: '回合／階段', action: '玩家行動與效果',
  end_scoring: '結束與計分', edition_player_count: '人數／版本／擴充',
  always: '全程適用', uncategorized: '未分類',
};

export const RuleCard = ({ rule, gameName, gameHref, onEdit, onTagClick }: { rule: RuleCardType; gameName?: string; gameHref?: string; onEdit?: () => void; onTagClick?: (tag: string) => void }) => {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const isLongDetails = Boolean(rule.details && rule.details.length > 80);

  return <article className="rule-card" id={`rule-${rule.id}`}>
    <div className="rule-meta"><span>{gameName ?? (rule.flowStage ? stageNames[rule.flowStage] : undefined)}</span>{gameName && rule.flowStage && <span>{stageNames[rule.flowStage]}</span>}</div>
    <h3 className="statement-text">
      <span className="statement-badge">💡 正確規則</span>
      <span>{gameHref ? <Link className="rule-title-link" to={gameHref}>{rule.statement}</Link> : rule.statement}</span>
    </h3>
    {rule.commonMistake && <p className="mistake"><strong className="mistake-badge">⚠️ 常見錯法</strong> <span className="mistake-text">{rule.commonMistake}</span></p>}
    {rule.details && <div className={isLongDetails && !detailsExpanded ? 'rule-details collapsed' : 'rule-details'}>
      <p>{rule.details}</p>
      {isLongDetails && <button type="button" className="text-action details-toggle" onClick={() => setDetailsExpanded((prev) => !prev)}>
        {detailsExpanded ? '收合' : '展開詳細'}
      </button>}
    </div>}
    {rule.tags.length > 0 && <div className="rule-tags" aria-label="主題標籤">{rule.tags.slice(0, 3).map((tag) => onTagClick
    ? <button type="button" className="tag-chip" key={tag.id} onClick={() => onTagClick(tag.name)}>#{tag.name}</button>
    : <span className="tag-chip" key={tag.id}>#{tag.name}</span>)}{rule.tags.length > 3 && <span className="tag-overflow">＋{rule.tags.length - 3}</span>}</div>}
  <div className="rule-notes">
    {rule.playerCountNote && <span>人數：{rule.playerCountNote}</span>}
    {rule.editionNote && <span>版本：{rule.editionNote}</span>}
    {rule.sourceLabel && <span>來源：{rule.sourceLabel}</span>}
    {rule.sourceLinks.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">查看依據{rule.sourceLinks.length > 1 ? ` ${index + 1}` : ''} ↗</a>)}
    {!rule.sourceLabel && rule.sourceLinks.length === 0 && <span className="unverified">未附來源</span>}
  </div>
  {onEdit && <button type="button" className="text-action" onClick={onEdit}>編輯</button>}
  </article>;
};
