import { useContext, useState } from 'react';
import type { RuleCard as RuleCardType } from '../shared/types';
import { Link, useNavigate } from 'react-router-dom';
import { ToastContext } from '../context/ToastContext';
import { formatPlayerCounts } from '../lib/playerCounts';

export interface RuleCardProps {
  rule: RuleCardType;
  gameName?: string;
  englishName?: string;
  gameHref?: string;
  onEdit?: () => void;
  onTagClick?: (tag: string) => void;
  importanceVoted?: boolean;
  importanceSaving?: boolean;
  onToggleImportance?: () => void;
}

export const RuleCard = ({
  rule,
  gameName,
  englishName,
  gameHref,
  onEdit,
  onTagClick,
  importanceVoted = false,
  importanceSaving = false,
  onToggleImportance,
}: RuleCardProps) => {
  const [statementExpanded, setStatementExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const navigate = useNavigate();
  const toastState = useContext(ToastContext);
  const showToast = toastState?.showToast ?? (() => undefined);
  const hasCredits = Boolean(rule.createdByNickname || rule.editedByNicknames?.length);
  const hasReviewMeta = (rule.reviewStatus ?? 'not_required') !== 'not_required';

  const effectiveGameName = gameName || (rule as any).gameName;
  const effectiveGameSlug = (gameHref ? gameHref.replace('/games/', '') : undefined) || (rule as any).gameSlug;
  const effectiveGameHref = gameHref || (effectiveGameSlug ? `/games/${effectiveGameSlug}` : undefined);
  const effectiveEnglishName = englishName || (rule as any).englishName;

  const isLongStatement = rule.statement.length > 80;
  const displayStatement = isLongStatement && !statementExpanded
    ? `${rule.statement.slice(0, 80)}...`
    : rule.statement;
  const isLongDetails = Boolean(rule.details && rule.details.length > 80);
  const displayDetails = isLongDetails && !detailsExpanded
    ? `${rule.details!.slice(0, 80)}...`
    : rule.details;

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
    if (effectiveGameHref) {
      navigate(`${effectiveGameHref}#rule-${rule.id}`);
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
            {(rule.editionNotes?.length ? rule.editionNotes : (rule.editionNote ? [rule.editionNote] : [])).map((edition) => (
              <span className="attr-chip edition-chip" key={edition}>📦 {edition}</span>
            ))}
            {Boolean(rule.playerCounts?.length) && (
              <span className="attr-chip player-chip">👥 {formatPlayerCounts(rule.playerCounts!)}</span>
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

      {/* 第三行：正確規則 */}
      <div className="rule-statement-section">
        <p className="statement-text">
          {displayStatement}
        </p>
        {isLongStatement && (
          <button
            type="button"
            className="text-action details-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setStatementExpanded((prev) => !prev);
            }}
          >
            {statementExpanded ? '收合' : '展開詳細'}
          </button>
        )}
      </div>

      {/* 第四行：玩錯情況 */}
      {rule.commonMistake && (
        <div className="mistake">
          <strong className="mistake-badge">⚠️ 玩錯情況</strong>
          <p className="mistake-text">{rule.commonMistake}</p>
        </div>
      )}

      {rule.details && (
        <div className="rule-details-note">
          <strong className="details-badge">補充說明</strong>
          <p className="details-text">{displayDetails}</p>
          {isLongDetails && (
            <button
              type="button"
              className="text-action details-toggle"
              onClick={(event) => {
                event.stopPropagation();
                setDetailsExpanded((previous) => !previous);
              }}
            >
              {detailsExpanded ? '收合補充' : '展開補充'}
            </button>
          )}
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
