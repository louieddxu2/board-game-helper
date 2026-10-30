import { useContext, useRef } from 'react';
import type { RuleCard as RuleCardType } from '../shared/types';
import { Link, useNavigate } from 'react-router-dom';
import { ToastContext } from '../context/ToastContext';
import { formatPlayerCounts } from '../lib/playerCounts';
import { getRuleEditions } from '../lib/editionOptions';
import zhTWCopy from '../content/zh-TW.json';
import { RuleCardSource } from './RuleCardSource';
import { copyRuleContent } from '../lib/ruleClipboard';

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

const toggleFromKeyboard = (event: React.KeyboardEvent<HTMLParagraphElement>, onToggle: () => void) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onToggle();
};

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

  const getRuleUrl = () => {
    const targetPath = effectiveGameHref ? `${effectiveGameHref}#rule-${rule.id}` : `${window.location.pathname}#rule-${rule.id}`;
    return `${window.location.origin}${targetPath}`;
  };

  const copyRuleLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(getRuleUrl()).then(() => {
      showToast('已複製這條規則的直接連結 🔗', 'info');
    }).catch(() => {
      showToast('無法複製，請確認瀏覽器的剪貼簿權限', 'error');
    });
  };

  const copyContent = (event: React.MouseEvent) => {
    event.stopPropagation();
    void copyRuleContent(rule, getRuleUrl()).then((format) => {
      showToast(format === 'rich' ? '已複製內文，支援格式的貼上可保留原文連結' : '已複製純文字內文', 'info');
    }).catch(() => {
      showToast('無法複製，請確認瀏覽器的剪貼簿權限', 'error');
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
  const hasHeader = Boolean(titleText || ruleEditions.length || rule.playerCounts?.length
    || rule.tags?.length || hasCredits || hasReviewMeta || onEdit);
  const expandedTextToggleProps = onToggleExpanded ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': true,
    onClick: onToggleExpanded,
    onKeyDown: (event: React.KeyboardEvent<HTMLParagraphElement>) => toggleFromKeyboard(event, onToggleExpanded),
  } : {};

  return (
    <article
      className={effectiveGameHref ? 'rule-card clickable' : 'rule-card'}
      id={`rule-${rule.id}`}
      onClick={onToggleExpanded ? undefined : handleCardClick}
    >
      {hasHeader && <div className="rule-card-header">
        {(hasCredits || hasReviewMeta || onEdit) && <div className="rule-card-header-actions">
          {(hasCredits || hasReviewMeta) && (
            <small className="rule-credits" aria-label="規則作者資訊">
              {rule.createdByNickname && <span>建立：{rule.createdByNickname}</span>}
              {Boolean(rule.editedByNicknames?.length) && <span>修改：{rule.editedByNicknames!.join('、')}</span>}
              {rule.reviewStatus === 'pending' && <span>未審核</span>}
              {rule.reviewStatus === 'reviewed' && <span>{rule.reviewedByNickname ? `審核：${rule.reviewedByNickname}` : '審核完成'}</span>}
            </small>
          )}
          {onEdit && <button type="button" className="text-action edit-btn" onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}>編輯</button>}
        </div>}
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
            <div className={rule.tags.length > 2 ? 'rule-tags rule-tags-many' : 'rule-tags'} aria-label="主題標籤">
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

      </div>}

      {/* 第三行：標準規則欄位 */}
      <div className="rule-statement-section">
        <p className={onToggleExpanded ? 'statement-text rule-toggle-text' : 'statement-text'} {...expandedTextToggleProps}>
          {rule.statement}
        </p>
      </div>

      {/* 第四行：常見錯誤欄位 */}
      {rule.commonMistake && (
        <div className="mistake">
          <strong className="mistake-badge"><span>{zhTWCopy.terms.mistakeSituation.slice(0, 2)}<br />{zhTWCopy.terms.mistakeSituation.slice(2)}</span></strong>
          <p className={onToggleExpanded ? 'mistake-text rule-toggle-text' : 'mistake-text'} {...expandedTextToggleProps}>{rule.commonMistake}</p>
        </div>
      )}

      {rule.details && (
        <div className="rule-details-note">
          <strong className="details-badge"><span>補充<br />說明</span></strong>
          <p className={onToggleExpanded ? 'details-text rule-toggle-text' : 'details-text'} {...expandedTextToggleProps}>{rule.details}</p>
        </div>
      )}

      {/* 第五行：來源與右下角操作按鈕 */}
      <div className="rule-card-footer">
        <RuleCardSource sourceLabel={rule.sourceLabel} sourceLinks={rule.sourceLinks} />

        <div className="rule-card-footer-actions">
          {(onToggleImportance || (rule.importanceCount ?? 0) > 0) && (onToggleImportance ? <button
            type="button"
            className={importanceVoted ? 'importance-button active' : 'importance-button'}
            aria-pressed={importanceVoted}
            aria-label={`${importanceVoted ? '取消重要標記' : '將這條規則標為重要'}，目前 ${rule.importanceCount ?? 0}`}
            aria-busy={importanceSaving || undefined}
            disabled={importanceSaving}
            onClick={(event) => { event.stopPropagation(); onToggleImportance(); }}
            title={importanceVoted ? '取消重要標記' : '將這條規則標為重要'}
          >
            <span className="importance-action-copy" aria-hidden="true">
              <strong>重要！</strong>
              <span className="importance-feedback">
                {importanceVoted ? <svg className="importance-selection-mark" viewBox="0 0 18 16" focusable="false">
                  <path d="m2 8 5 5L16 2" />
                </svg> : <span className="importance-increment">+1</span>}
              </span>
            </span>
            <span className="importance-tally" aria-hidden="true"><strong>{rule.importanceCount ?? 0}</strong></span>
          </button> : <span className="importance-count" aria-label={`標記數量 ${rule.importanceCount ?? 0}`}>
            <strong>{rule.importanceCount ?? 0}</strong>
          </span>)}
          <button
            type="button"
            className="icon-action-button"
            onClick={copyContent}
            title="複製內文，支援格式的貼上可保留原文連結"
            aria-label="複製內文"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-action-button"
            onClick={copyRuleLink}
            title="複製這條規則的分享連結"
            aria-label="分享此規則"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="6" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="17.5" cy="6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="17.5" cy="18" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="m8 11 7.4-4M8 13l7.4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  );
};

export interface CompactRuleCardProps {
  rule: RuleCardType;
  onToggleExpanded: () => void;
}

export const CompactRuleCard = ({
  rule,
  onToggleExpanded,
}: CompactRuleCardProps) => {
  const ruleEditions = getRuleEditions(rule);
  const press = useRef<{ x: number; y: number; started: number; canceled: boolean } | null>(null);
  return (
    <button
      type="button"
      className="rule-card-compact"
      id={`rule-${rule.id}`}
      aria-label={`展開規則：${rule.statement}`}
      aria-describedby={`rule-${rule.id}-meta${rule.commonMistake ? ` rule-${rule.id}-mistake` : ''}`}
      aria-expanded={false}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) {
          if (press.current) press.current.canceled = true;
          return;
        }
        press.current = { x: event.clientX, y: event.clientY, started: performance.now(), canceled: false };
      }}
      onPointerMove={(event) => {
        if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) press.current.canceled = true;
      }}
      onPointerUp={() => {
        if (press.current && performance.now() - press.current.started >= 500) press.current.canceled = true;
      }}
      onPointerCancel={() => { if (press.current) press.current.canceled = true; }}
      onContextMenu={() => { if (press.current) press.current.canceled = true; }}
      onClick={(event) => {
        const gesture = press.current;
        press.current = null;
        if (event.detail !== 0 && gesture?.canceled) return;
        onToggleExpanded();
      }}
    >
      <span className="compact-expand-hint" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </span>
      <span className="compact-rule-meta" id={`rule-${rule.id}-meta`}>
        {Boolean(rule.playerCounts?.length) && (
          <span className="compact-attribute">👥 {formatPlayerCounts(rule.playerCounts!)}</span>
        )}
        {ruleEditions.map((edition) => (
          <span className="compact-attribute" key={edition}>📦 {edition}</span>
        ))}
        {rule.tags.map((tag) => (
          <span className="compact-attribute compact-tag" key={tag.id}>#{tag.name}</span>
        ))}
      </span>
      <span className="compact-rule-row compact-rule-correct">
        <strong aria-label="正確">✅</strong>
        <span className="compact-rule-text">{rule.statement}</span>
      </span>
      {rule.commonMistake && (
        <span className="compact-rule-row compact-rule-mistake" id={`rule-${rule.id}-mistake`}>
          <strong aria-label="玩錯">❌</strong>
          <span className="compact-rule-text">{rule.commonMistake}</span>
        </span>
      )}
    </button>
  );
};
