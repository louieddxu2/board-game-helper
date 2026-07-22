import type { RuleCard as RuleCardType } from '../shared/types';
import { Link } from 'react-router-dom';

const stageNames: Record<string, string> = {
  setup: '設置', round: '回合／階段', action: '玩家行動與效果',
  end_scoring: '結束與計分', edition_player_count: '人數／版本／擴充',
  always: '全程適用', uncategorized: '未分類',
};

export const RuleCard = ({ rule, gameName, gameHref, onEdit }: { rule: RuleCardType; gameName?: string; gameHref?: string; onEdit?: () => void }) => <article className="rule-card">
  <div className="rule-meta"><span>{gameName ?? stageNames[rule.flowStage]}</span>{gameName && <span>{stageNames[rule.flowStage]}</span>}</div>
  <h3>{gameHref ? <Link className="rule-title-link" to={gameHref}>{rule.statement}</Link> : rule.statement}</h3>
  {rule.commonMistake && <p className="mistake"><strong>常見錯法</strong>{rule.commonMistake}</p>}
  {rule.details && <p>{rule.details}</p>}
  <div className="rule-notes">
    {rule.playerCountNote && <span>人數：{rule.playerCountNote}</span>}
    {rule.editionNote && <span>版本：{rule.editionNote}</span>}
    {rule.sourceLabel && <span>來源：{rule.sourceLabel}</span>}
    {rule.sourceUrl && <a href={rule.sourceUrl} target="_blank" rel="noreferrer">查看依據 ↗</a>}
    {!rule.sourceLabel && !rule.sourceUrl && <span className="unverified">未附來源</span>}
  </div>
  {onEdit && <button type="button" className="text-action" onClick={onEdit}>編輯</button>}
</article>;
