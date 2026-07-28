import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { RuleCard } from '../components/RuleCard';
import { EditionInput } from '../components/EditionInput';
import { PlayerCountInput } from '../components/PlayerCountInput';
import { TagInput } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { FLOW_STAGES, type FlowStage, type GameDetail, type RuleCard as RuleCardType, type RuleRevision } from '../shared/types';
import { groupRulesUniversally, classifyRuleUniversally } from '../lib/ruleSorter';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { clearSearchCache } from '../components/GameSearch';
import { hydrateGameTags } from '../lib/tagHydration';
import { canUserEditRule } from '../lib/rulePermissions';
import { collectEditionOptions } from '../lib/editionOptions';

const stageNames: Record<FlowStage, string> = {
  setup: '設置', round: '回合／階段', action: '玩家行動與效果',
  end_scoring: '結束與計分', edition_player_count: '人數／版本／擴充',
  always: '全程適用', uncategorized: '未分類',
};

export const GamePage = () => {
  const { identifier = '' } = useParams();
  const location = useLocation();
  const { canEdit, user, isAdmin } = useSession();
  const canEditRule = (rule: RuleCardType) => canUserEditRule(rule, user, isAdmin);
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<'index' | 'briefing'>('index');
  const [game, setGame] = useState<GameDetail>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RuleCardType>();
  const [editingGame, setEditingGame] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>(() => {
    const searchParams = new URLSearchParams(location.search);
    const tagParam = searchParams.get('tag') || searchParams.get('tags');
    return tagParam ? tagParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  });

  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };
  const [ruleQuery, setRuleQuery] = useState(() => new URLSearchParams(location.search).get('find') ?? '');
  const load = async () => {
    try {
      const response = await api.game(identifier);
      const hydratedGame = await hydrateGameTags(response.game);
      setGame(hydratedGame);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    const justAdded = Boolean((location.state as { justAdded?: number } | null)?.justAdded);
    void (justAdded ? localDb.invalidateGame(identifier) : Promise.resolve()).then(() => api.game(identifier)).then(async (response) => {
      const hydratedGame = await hydrateGameTags(response.game);
      if (active) setGame(hydratedGame);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identifier, location.state]);
  useEffect(() => {
    if (!game || !location.hash) return;
    window.setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [game, location.hash]);
  useEffect(() => {
    if (!game || !user) return;
    const today = new Date().toISOString().slice(0, 10);
    const storageKey = `viewed:game:${game.id}:${today}`;
    if (!localStorage.getItem(storageKey)) {
      api.recordView(game.id).catch(() => undefined);
      localStorage.setItem(storageKey, '1');
    }
  }, [game, user]);
  const availableTags = useMemo(() => Array.from(new Set(game?.rules.flatMap((rule) => rule.tags.map((tag) => tag.name)) ?? [])).sort(), [game]);
  const normalizedQuery = ruleQuery.trim().toLocaleLowerCase();
  const visibleRules = game?.rules.filter((rule) =>
    (activeTags.length === 0 || activeTags.every((tagName) => rule.tags.some((tag) => tag.name === tagName))) &&
    (!normalizedQuery || [rule.statement, rule.commonMistake, rule.details, ...rule.tags.map((tag) => tag.name)].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)))
  ) ?? [];
  const groupedSections = useMemo(() => groupRulesUniversally(visibleRules), [visibleRules]);
  const briefingRules = useMemo(() => {
    if (!game) return [];
    const highlights = game.rules.filter((rule) => classifyRuleUniversally(rule) === 'highlight');
    return highlights.length > 0 ? highlights : game.rules.slice(0, 3);
  }, [game]);
  const justAdded = (location.state as { justAdded?: number } | null)?.justAdded;
  useEffect(() => {
    if (justAdded) showToast(`已經記下 ${justAdded} 條規則。下次開桌前，它們會在這裡等你。`);
  }, []); // 只在 mount 時執行一次
  if (!game && loading) return <section className="game-page"><header className="game-hero"><div><div className="skeleton-line title" style={{ width: '50%' }} /><div className="skeleton-line medium" /></div></header><div className="game-rules">{Array.from({ length: 4 }, (_, index) => (<div className="skeleton-card" key={index}><div className="skeleton-line title" /><div className="skeleton-line" /><div className="skeleton-line medium" /><div className="skeleton-line short" /></div>))}</div></section>;
  if (!game) return <section className="narrow-page"><h1>找不到這款遊戲</h1><Link to="/">回首頁搜尋</Link></section>;
  return <section className="game-page">
    <header className="game-hero">
      <div><h1>{game.displayName}</h1>{game.englishName && <p className="english-name">{game.englishName}</p>}
        <p>{game.ruleCount} 條易錯規則紀錄</p></div>
      {canEdit && <div className="inline-actions">{(isAdmin || (!game.renameLocked && game.renameOwnerId === user?.id))
        ? <button type="button" className="button secondary" onClick={() => setEditingGame(true)}>編輯遊戲名稱</button>
        : <span className="muted game-name-locked" title="已有其他作者參與，只有管理員可以修改遊戲名稱。">遊戲名稱已鎖定</span>}
        <Link className="button primary" to={`/add?game=${game.slug}`}>＋新增規則</Link></div>}
    </header>
    <div className="view-mode-header">
      <div className="view-mode-switcher" role="tablist" aria-label="檢視模式切換">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'index'}
          className={viewMode === 'index' ? 'active' : ''}
          onClick={() => setViewMode('index')}
        >
          📚 完整索引
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'briefing'}
          className={viewMode === 'briefing' ? 'active' : ''}
          onClick={() => setViewMode('briefing')}
        >
          ⚡ 30 秒速覽
        </button>
      </div>
    </div>
    {viewMode === 'briefing' ? (
      <>
        <div className="briefing-notice">
          <h2>⚡ 30 秒速覽</h2>
          <p>整理本遊戲常被誤解的重點規則。</p>
        </div>
        <div className="game-rules">
          {briefingRules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} gameId={game.id} gameName={game.displayName} englishName={game.englishName} onTagClick={toggleTag} onEdit={canEditRule(rule) ? () => setEditing(rule) : undefined} />
          ))}
        </div>
      </>
    ) : (
      <>
        <section className="rule-filters" aria-label="篩選規則">
          <label className="rule-search">在這款遊戲中搜尋<input type="search" value={ruleQuery} onChange={(event) => setRuleQuery(event.target.value)} placeholder="例如：補牌、平手、三人局" /></label>
          {availableTags.length > 0 && (
            <div className="tag-filter" aria-label="依標籤篩選">
              {availableTags.map((tag) => {
                const isSelected = activeTags.includes(tag);
                return (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    className={isSelected ? 'tag-chip active' : 'tag-chip'}
                    key={tag}
                    onClick={() => toggleTag(tag)}
                  >
                    {isSelected ? '✓ ' : ''}#{tag}
                  </button>
                );
              })}
              {activeTags.length > 0 && (
                <button
                  type="button"
                  className="clear-tags-btn"
                  onClick={() => setActiveTags([])}
                >
                  清除篩選 ✕
                </button>
              )}
            </div>
          )}
        </section>
        <div className="grouped-rules-container">
          {groupedSections.map((group) => (
            <section key={group.id} className="rule-group-section">
              <h2 className="rule-group-heading">
                <span>{group.icon} {group.title}</span>
                <span className="group-count">{group.rules.length}</span>
              </h2>
              <div className="game-rules">
                {group.rules.map((rule) => (
                  <RuleCard key={rule.id} rule={rule} gameId={game.id} gameName={game.displayName} englishName={game.englishName} onTagClick={toggleTag} onEdit={canEditRule(rule) ? () => setEditing(rule) : undefined} />
                ))}
              </div>
            </section>
          ))}
          {visibleRules.length === 0 && <div className="empty-state"><p>找不到符合目前條件的規則。</p><button type="button" className="text-action" onClick={() => { setActiveTags([]); setRuleQuery(''); }}>清除篩選</button></div>}
        </div>
      </>
    )}
    {game.aliases.length > 0 && <aside className="alias-box"><strong>也可以用這些名稱找到</strong><p>{game.aliases.join('・')}</p></aside>}
    {editing && <RuleEditor game={game} rule={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await localDb.invalidateRuleEntity(editing.id); await localDb.invalidateGame(game.slug); clearSearchCache(); await load(); }} />}
    {editingGame && <GameEditor game={game} onClose={() => setEditingGame(false)} onSaved={async () => { setEditingGame(false); await localDb.invalidateGame(game.slug); await localDb.invalidateHome(); clearSearchCache(); await load(); }} />}
  </section>;
};

export const RuleEditor = ({ game, rule, onClose, onSaved }: { game: GameDetail; rule: RuleCardType; onClose(): void; onSaved(): Promise<void> }) => {
  const { isAdmin } = useSession();
  const { confirm } = useConfirm();
  const [statement, setStatement] = useState(rule.statement);
  const [commonMistake, setCommonMistake] = useState(rule.commonMistake ?? '');
  const [details, setDetails] = useState(rule.details ?? '');
  const [playerCounts, setPlayerCounts] = useState(rule.playerCounts ?? []);
  const [editionNotes, setEditionNotes] = useState(rule.editionNotes ?? (rule.editionNote ? [rule.editionNote] : []));
  const [tagNames, setTagNames] = useState(rule.tags.map((tag) => tag.name));
  const [sourceLabel, setSourceLabel] = useState(rule.sourceLabel ?? '');
  const [sourceUrl, setSourceUrl] = useState(rule.sourceUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState<RuleRevision[]>();
  const editionOptions = useMemo(() => collectEditionOptions(game.rules), [game.rules]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = ''; };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      await api.patchRule(rule.id, { statement, commonMistake: commonMistake || null, details: details || null, playerCounts, editionNotes, tagNames, sourceLabel: sourceLabel || null, sourceUrl: sourceUrl || null });
      await onSaved();
    } finally { setSaving(false); }
  };
  const hide = async () => {
    if (await confirm({ title: '隱藏規則？', message: '隱藏後仍可從管理頁恢復。', confirmLabel: '隱藏規則', tone: 'danger' })) {
      await api.hideRule(rule.id); await onSaved();
    }
  };
  return <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-rule-title">
      <div className="modal-heading"><h2 id="edit-rule-title">編輯規則</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>規則結論<textarea rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
      <label>玩錯情況<textarea rows={2} value={commonMistake} onChange={(event) => setCommonMistake(event.target.value)} /></label>
      <label>補充說明<textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <TagInput value={tagNames} onChange={setTagNames} canCreate={isAdmin} availableTags={game.rules.flatMap((gameRule) => gameRule.tags)} detectionInput={{ statement, commonMistake, details }} />
      <PlayerCountInput value={playerCounts} onChange={setPlayerCounts} />
      <EditionInput value={editionNotes} options={editionOptions} onChange={setEditionNotes} />
      <div className="two-columns"><label>參考資料<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} /></label><label>資料網址<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label></div>
      <section className="revision-panel">
        <button type="button" className="text-action" onClick={() => void api.ruleRevisions(rule.id).then((data) => setRevisions(data.revisions))}>查看版本紀錄</button>
        {revisions && (revisions.length ? <div className="admin-list">{revisions.map((revision) => <div key={revision.id}>
          <span><strong>{revision.previousStatement}</strong><small>{new Date(revision.createdAt).toLocaleString('zh-TW')}・{revision.reason}</small></span>
          <button type="button" className="text-action" onClick={() => void confirm({ title: '恢復這個版本？', message: '目前內容也會保留在版本紀錄中。', confirmLabel: '恢復版本' }).then((confirmed) => { if (confirmed) return api.restoreRevision(rule.id, revision.id).then(onSaved); })}>恢復</button>
        </div>)}</div> : <p className="muted">尚無較早版本。</p>)}
      </section>
      <div className="modal-actions"><button type="button" className="danger-link" onClick={() => void hide()}>隱藏</button><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={!statement.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存修改'}</button></div></div>
    </div>
  </div>;
};

const GameEditor = ({ game, onClose, onSaved }: { game: GameDetail; onClose(): void; onSaved(): Promise<void> }) => {
  const [displayName, setDisplayName] = useState(game.displayName);
  const [englishName, setEnglishName] = useState(game.englishName ?? '');
  const [aliases, setAliases] = useState(game.aliases.filter((alias) => alias !== game.displayName && alias !== game.englishName).join('\n'));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = ''; };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      await api.patchGame(game.id, { displayName, englishName: englishName || undefined, aliases: aliases.split('\n').map((value) => value.trim()).filter(Boolean) });
      await onSaved();
    } finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-game-title">
      <div className="modal-heading"><h2 id="edit-game-title">編輯遊戲名稱</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>顯示名稱<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>英文名稱<input value={englishName} onChange={(event) => setEnglishName(event.target.value)} /></label>
      <label>可搜尋的別名（每行一個）<textarea rows={5} value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
      <div className="modal-actions"><span /><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={!displayName.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存遊戲'}</button></div></div>
    </div>
  </div>;
};
