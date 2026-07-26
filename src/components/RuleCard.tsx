import { useContext, useState } from 'react';
import type { RuleCard as RuleCardType } from '../shared/types';
import { Link, useNavigate } from 'react-router-dom';
import { SessionContext } from '../context/SessionContext';
import { ToastContext } from '../context/ToastContext';
import { api } from '../lib/api';

export interface RuleCardProps {
  rule: RuleCardType;
  gameName?: string;
  englishName?: string;
  gameHref?: string;
  onEdit?: () => void;
  onTagClick?: (tag: string) => void;
  gameId?: string;
  showSource?: boolean;
}

export const RuleCard = ({
  rule,
  gameName,
  englishName,
  gameHref,
  onEdit,
  onTagClick,
  gameId,
  showSource = true,
}: RuleCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const session = useContext(SessionContext);
  const toastState = useContext(ToastContext);
  const showToast = toastState?.showToast ?? (() => undefined);
  const user = session?.user;

  const effectiveEnglishName = englishName || (rule as any).englishName;

  // 結合 statement 與 details
  const fullContent = rule.details
    ? `${rule.statement}\n${rule.details}`
    : rule.statement;

  const isLongContent = fullContent.length > 80;
  const displayContent = isLongContent && !expanded
    ? `${fullContent.slice(0, 80)}...`
    : fullContent;

  const copyRuleLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetPath = gameHref ? `${gameHref}#rule-${rule.id}` : `${window.location.pathname}#rule-${rule.id}`;
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
    if (gameHref) {
      navigate(`${gameHref}#rule-${rule.id}`);
    }
  };

  const titleText = gameName
    ? `${gameName}${effectiveEnglishName ? ` (${effectiveEnglishName})` : ''}`
    : effectiveEnglishName
    ? `(${effectiveEnglishName})`
    : undefined;

  return (
    <article
      className={gameHref ? 'rule-card clickable' : 'rule-card'}
      id={`rule-${rule.id}`}
      onClick={handleCardClick}
    >
      {/* 第一行：遊戲名稱(英文名稱)、屬性(擴充、人數)、右上編輯 */}
      <div className="rule-card-header">
        <div className="rule-card-title-group">
          {titleText && (
            <h3 className="rule-game-title">
              {gameHref ? (
                <Link className="rule-title-link" to={gameHref} onClick={(e) => e.stopPropagation()}>
                  {titleText}
                </Link>
              ) : (
                <span>{titleText}</span>
              )}
            </h3>
          )}

          {/* 屬性：擴充、人數 */}
          <div className="rule-attributes">
            {rule.editionNote && (
              <span className="attr-chip edition-chip">📦 {rule.editionNote}</span>
            )}
            {rule.playerCountNote && (
              <span className="attr-chip player-chip">👥 {rule.playerCountNote}</span>
            )}
          </div>
        </div>

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

      {/* 第二行：標籤列 */}
      {rule.tags && rule.tags.length > 0 && (
        <div className="rule-tags" aria-label="主題標籤">
          {rule.tags.map((tag) =>
            onTagClick ? (
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
              <span className="tag-chip" key={tag.id}>
                #{tag.name}
              </span>
            )
          )}
        </div>
      )}

      {/* 第三行：正確規則 */}
      <div className="rule-statement-section">
        <p className="statement-text">
          {displayContent}
        </p>
        {isLongContent && (
          <button
            type="button"
            className="text-action details-toggle"
            onClick={(e) => {
              e.stopPropagation();
              if (!expanded && user && gameId) {
                const today = new Date().toISOString().slice(0, 10);
                const storageKey = `viewed_rule:${rule.id}:${today}`;
                if (!localStorage.getItem(storageKey)) {
                  api.recordView(gameId, rule.id).catch(() => undefined);
                  localStorage.setItem(storageKey, '1');
                }
              }
              setExpanded((prev) => !prev);
            }}
          >
            {expanded ? '收合' : '展開詳細'}
          </button>
        )}
      </div>

      {/* 第四行：玩錯版本 */}
      {rule.commonMistake && (
        <div className="mistake">
          <strong className="mistake-badge">⚠️ 玩錯版本</strong>
          <p className="mistake-text">{rule.commonMistake}</p>
        </div>
      )}

      {/* 第五行：來源與右下角「分享此規則 🔗」 */}
      <div className="rule-card-footer">
        {showSource && <div className="rule-source">
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
        </div>}

        <button
          type="button"
          className="text-action copy-link-btn"
          onClick={copyRuleLink}
          title="複製這條規則的分享連結"
        >
          分享此規則 🔗
        </button>
      </div>
    </article>
  );
};
