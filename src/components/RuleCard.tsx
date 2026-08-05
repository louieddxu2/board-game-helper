import { useContext } from 'react';
import type { RuleCard as RuleCardType } from '../shared/types';
import { Link, useNavigate } from 'react-router-dom';
import { ToastContext } from '../context/ToastContext';
import { formatPlayerCounts } from '../lib/playerCounts';
import { getRuleEditions } from '../lib/editionOptions';
import zhTWCopy from '../content/zh-TW.json';

export interface RuleCardProps {
  rule: RuleCardType;
  gameName?: string;
  englishName?: string;
  gameHref?: string;
  showGameContext?: boolean;
  onEdit?: () => void;
  onTagClick?: (tag: string) => void;
  onPlayerCountsClick?: (counts: number[]) => void;
  onEditionClick?: (edition: string) => void;
  onToggleExpanded?: () => void;
  importanceVoted?: boolean;
  importanceSaving?: boolean;
  onToggleImportance?: () => void;
}

export const RuleCard = ({
  rule,
  gameName,
  englishName,
  gameHref,
  showGameContext,
  onEdit,
  onTagClick,
  onPlayerCountsClick,
  onEditionClick,
  onToggleExpanded,
  importanceVoted = false,
  importanceSaving = false,
  onToggleImportance,
}: RuleCardProps) => {
  const navigate = useNavigate();
  const toastState = useContext(ToastContext);
  const showToast = toastState?.showToast ?? (() => undefined);
  const hasCredits = Boolean(rule.createdByNickname || rule.editedByNicknames?.length);
  const hasReviewMeta = (rule.reviewStatus ?? 'not_required') !== 'not_required';
  const ruleEditions = getRuleEditions(rule);

  const shouldShowGameContext = showGameContext ?? Boolean(gameName || englishName || gameHref);
  const effectiveGameName = shouldShowGameContext ? gameName || (rule as any).gameName : undefined;
  const effectiveGameSlug = shouldShowGameContext
    ? (gameHref ? gameHref.replace('/games/', '') : undefined) || (rule as any).gameSlug
    : undefined;
  const effectiveGameHref = shouldShowGameContext
    ? gameHref || (effectiveGameSlug ? `/games/${effectiveGameSlug}` : undefined)
    : undefined;
  const effectiveEnglishName = shouldShowGameContext ? englishName || (rule as any).englishName : undefined;

  const copyRuleLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetPath = effectiveGameHref ? `${effectiveGameHref}#rule-${rule.id}` : `${window.location.pathname}#rule-${rule.id}`;
    const fullUrl = `${window.location.origin}${targetPath}`;
    void navigator.clipboard.writeText(fullUrl).then(() => {
      showToast('已複製這條規則的直接連結 🔗', 'info');
    });
  };

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, label')) {
      return;
    }
    if (onToggleExpanded) {
      onToggleExpanded();
      return;
    }
    if (effectiveGameHref) {
      navigate(`${effectiveGameHref}#rule-${rule.id}`);
    }
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!onToggleExpanded || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleExpanded();
    }
  };

  const titleText = effectiveGameHref && effectiveGameName
    ? `${effectiveGameName}${effectiveEnglishName ? ` (${effectiveEnglishName})` : ''}`
    : undefined;

  return (
    <article
      className={effectiveGameHref ? 'rule-card clickable' : 'rule-card'}
      id={`rule-${rule.id}`}
      onClick={handleCardClick}
      onKeyDown={onToggleExpanded ? handleCardKeyDown : undefined}
      role={onToggleExpanded ? 'button' : undefined}
      tabIndex={onToggleExpanded ? 0 : undefined}
      aria-expanded={onToggleExpanded ? true : undefined}
    >
      {/* 第一行：遊戲名稱(英文名稱)、屬性(擴充、人數)、右上編輯 */}
      <div className="rule-card-header">
        <div className="rule-card-title-group">
          {titleText && (
            <h3 className="rule-game-title">
              {effectiveGameHref ? (
                <Link className="rule-title-link" to={effectiveGameHref} onClick={(e) => e.stopPropagation()}>
                  {titleText}
                </Link>
              ) : (
                <span>{titleText}</span>
              )}
            </h3>
          )}

          {/* 屬性：擴充、人數 */}
          <div className="rule-attributes">
            {ruleEditions.map((edition) => (
              onEditionClick ? (
                <button type="button" className="attr-chip edition-chip" key={edition} onClick={(event) => { event.stopPropagation(); onEditionClick(edition); }}>
                  📦 {edition}
                </button>
              ) : <span className="attr-chip edition-chip" key={edition}>📦 {edition}</span>
            ))}
            {Boolean(rule.playerCounts?.length) && (
              onPlayerCountsClick ? (
                <button type="button" className="attr-chip player-chip" onClick={(event) => { event.stopPropagation(); onPlayerCountsClick(rule.playerCounts!); }}>
                  👥 {formatPlayerCounts(rule.playerCounts!)}
                </button>
              ) : <span className="attr-chip player-chip">👥 {formatPlayerCounts(rule.playerCounts!)}</span>
            )}
          </div>

          {Boolean(rule.tags?.length) && (
            <div className="rule-tags" aria-label="主題標籤">
              {rule.tags.map((tag) => onTagClick && !tag.unresolved ? (
                <button
                  type="button"
                  className="tag-chip"
                  key={tag.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick(tag.name);
                  }}
                >
                  #{tag.name}
                </button>
              ) : (
                <span className="tag-chip" key={tag.id}>#{tag.name}</span>
              ))}
            </div>
          )}
        </div>

        {(hasCredits || hasReviewMeta) && (
          <small className="rule-credits" aria-label="規則作者資訊">
            {rule.createdByNickname && <span>建立：{rule.createdByNickname}</span>}
            {Boolean(rule.editedByNicknames?.length) && <span>修改：{rule.editedByNicknames!.join('、')}</span>}
            {rule.reviewStatus === 'pending' && <span>未審核</span>}
            {rule.reviewStatus === 'reviewed' && <span>{rule.reviewedByNickname ? `審核：${rule.reviewedByNickname}` : '審核完成'}</span>}
          </small>
        )}

        {/* 右上角編輯按鈕 (僅當傳入 onEdit 且具有權限時顯示) */}
        {onEdit && (
          <button
            type="button"
            className="text-action edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            編輯
          </button>
        )}
      </div>

      {/* 第三行：標準規則欄位 */}
      <div className="rule-statement-section">
        <p className="statement-text">
          {rule.statement}
        </p>
      </div>

      {/* 第四行：常見錯誤欄位 */}
      {rule.commonMistake && (
        <div className="mistake">
          <strong className="mistake-badge">⚠️ {zhTWCopy.terms.mistakeSituation}</strong>
          <p className="mistake-text">{rule.commonMistake}</p>
        </div>
      )}

      {rule.details && (
        <div className="rule-details-note">
          <strong className="details-badge">補充說明</strong>
          <p className="details-text">{rule.details}</p>
        </div>
      )}

      {/* 第五行：來源與右下角「分享此規則 🔗」 */}
      <div className="rule-card-footer">
        <div className="rule-source">
          {rule.sourceLabel && <span>來源：{rule.sourceLabel}</span>}
          {rule.sourceLinks && rule.sourceLinks.map((source, index) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              查看依據{rule.sourceLinks.length > 1 ? ` ${index + 1}` : ''} ↗
            </a>
          ))}
          {!rule.sourceLabel && (!rule.sourceLinks || rule.sourceLinks.length === 0) && (
            <span className="unverified">未附來源</span>
          )}
        </div>

        <div className="rule-card-footer-actions">
          {(onToggleImportance || (rule.importanceCount ?? 0) > 0) && (onToggleImportance ? <button
            type="button"
            className={importanceVoted ? 'importance-button active' : 'importance-button'}
            aria-pressed={importanceVoted}
            aria-label={`${importanceVoted ? '取消「我也玩錯過」' : '將這條規則標為重要'}，目前 ${rule.importanceCount ?? 0}`}
            disabled={importanceSaving}
            onClick={(event) => { event.stopPropagation(); onToggleImportance(); }}
            title={importanceVoted ? '取消「我也玩錯過」' : '將這條規則標為重要'}
          >
            <span className="importance-action-copy" aria-hidden="true">
              <strong>{importanceSaving ? '處理中…' : '重要！'}</strong>
              <small className="importance-subtext">{importanceVoted ? '✓ 我也玩錯過' : '我也玩錯過'}</small>
            </span>
            <span className="importance-tally" aria-hidden="true"><strong>{rule.importanceCount ?? 0}</strong></span>
          </button> : <span className="importance-count" aria-label={`標記數量 ${rule.importanceCount ?? 0}`}>
            <strong>{rule.importanceCount ?? 0}</strong>
          </span>)}
          <button
            type="button"
            className="text-action copy-link-btn"
            onClick={copyRuleLink}
            title="複製這條規則的分享連結"
          >
            分享此規則 🔗
          </button>
        </div>
      </div>
    </article>
  );
};

export interface CompactRuleCardProps {
  rule: RuleCardType;
  onToggleExpanded: () => void;
  onTagClick?: (tag: string) => void;
  onPlayerCountsClick?: (counts: number[]) => void;
  onEditionClick?: (edition: string) => void;
}

export const CompactRuleCard = ({
  rule,
  onToggleExpanded,
  onTagClick,
  onPlayerCountsClick,
  onEditionClick,
}: CompactRuleCardProps) => {
  const ruleEditions = getRuleEditions(rule);
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, label')) return;
    onToggleExpanded();
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleExpanded();
    }
  };

  return (
    <article
      className="rule-card-compact"
      id={`rule-${rule.id}`}
      role="button"
      tabIndex={0}
      aria-expanded={false}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="compact-rule-meta">
        {Boolean(rule.playerCounts?.length) && (
          onPlayerCountsClick ? (
            <button type="button" className="compact-attribute" onClick={(event) => { event.stopPropagation(); onPlayerCountsClick(rule.playerCounts!); }}>
              👥 {formatPlayerCounts(rule.playerCounts!)}
            </button>
          ) : <span className="compact-attribute">👥 {formatPlayerCounts(rule.playerCounts!)}</span>
        )}
        {ruleEditions.map((edition) => (
          onEditionClick ? (
            <button type="button" className="compact-attribute" key={edition} onClick={(event) => { event.stopPropagation(); onEditionClick(edition); }}>
              📦 {edition}
            </button>
          ) : <span className="compact-attribute" key={edition}>📦 {edition}</span>
        ))}
        {rule.tags.map((tag) => (
          onTagClick && !tag.unresolved ? (
            <button type="button" className="compact-attribute compact-tag" key={tag.id} onClick={(event) => { event.stopPropagation(); onTagClick(tag.name); }}>
              #{tag.name}
            </button>
          ) : <span className="compact-attribute compact-tag" key={tag.id}>#{tag.name}</span>
        ))}
        <span className="compact-expand-hint" aria-hidden="true">展開 ›</span>
      </div>
      <div className="compact-rule-row compact-rule-correct">
        <strong>✅ 正確</strong>
        <p>{rule.statement}</p>
      </div>
      {rule.commonMistake && (
        <div className="compact-rule-row compact-rule-mistake">
          <strong>❌ 玩錯</strong>
          <p>{rule.commonMistake}</p>
        </div>
      )}
    </article>
  );
};
