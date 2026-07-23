import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { RuleCard } from '../components/RuleCard';
import { TagInput } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { FLOW_STAGES, type FlowStage, type GameDetail, type RuleCard as RuleCardType, type RuleRevision } from '../shared/types';

const stageNames: Record<FlowStage, string> = {
  setup: '設置', round: '回合／階段', action: '玩家行動與效果',
  end_scoring: '結束與計分', edition_player_count: '人數／版本／擴充',
  always: '全程適用', uncategorized: '未分類',
};

export const GamePage = () => {
  const { identifier = '' } = useParams();
  const location = useLocation();
  const { canEdit } = useSession();
  const [game, setGame] = useState<GameDetail>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RuleCardType>();
  const [editingGame, setEditingGame] = useState(false);
  const [activeStage, setActiveStage] = useState<FlowStage | 'all'>('all');
  const [activeTag, setActiveTag] = useState('');
  const [ruleQuery, setRuleQuery] = useState(() => new URLSearchParams(location.search).get('find') ?? '');
  const load = async () => {
    try {
      const response = await api.game(identifier, true);
      setGame(response.game);
      void localDb.cacheGame(response.game);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    void localDb.getCachedGame(identifier).then((cached) => { if (active && cached) setGame(cached.data); });
    api.game(identifier, Boolean((location.state as { justAdded?: number } | null)?.justAdded)).then((response) => {
      if (active) setGame(response.game);
      return localDb.cacheGame(response.game);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identifier]);
  useEffect(() => {
    if (!game || !location.hash) return;
    window.setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [game, location.hash]);
  const stages = useMemo(() => FLOW_STAGES.filter((stage) => game?.rules.some((rule) => rule.flowStage === stage)), [game]);
  const availableTags = useMemo(() => Array.from(new Set(game?.rules.flatMap((rule) => rule.tags.map((tag) => tag.name)) ?? [])).sort(), [game]);
  const normalizedQuery = ruleQuery.trim().toLocaleLowerCase();
  const visibleRules = game?.rules.filter((rule) => (activeStage === 'all' || rule.flowStage === activeStage)
    && (!activeTag || rule.tags.some((tag) => tag.name === activeTag))
    && (!normalizedQuery || [rule.statement, rule.commonMistake, rule.details, ...rule.tags.map((tag) => tag.name)].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)))) ?? [];
  if (!game && loading) return <section className="narrow-page"><p>載入遊戲中…</p></section>;
  if (!game) return <section className="narrow-page"><h1>找不到這款遊戲</h1><Link to="/">回首頁搜尋</Link></section>;
  const justAdded = (location.state as { justAdded?: number } | null)?.justAdded;
  return <section className="game-page">
    <header className="game-hero">
      <div><p className="eyebrow">開桌前快速複習</p><h1>{game.displayName}</h1>{game.englishName && <p className="english-name">{game.englishName}</p>}
        <p>{game.ruleCount} 條曾經讓人踩坑的規則</p></div>
      {canEdit && <div className="inline-actions"><button type="button" className="button secondary" onClick={() => setEditingGame(true)}>編輯遊戲名稱</button><Link className="button primary" to={`/add?game=${game.id}`}>＋新增規則</Link></div>}
    </header>
    {justAdded && <div className="success-banner">已經記下 {justAdded} 條規則。下次開桌前，它們會在這裡等你。</div>}
    <section className="rule-filters" aria-label="篩選規則">
      <label className="rule-search">在這款遊戲中搜尋<input type="search" value={ruleQuery} onChange={(event) => setRuleQuery(event.target.value)} placeholder="例如：補牌、平手、三人局" /></label>
      <nav className="stage-tabs" aria-label="規則流程分類">
        <button type="button" aria-pressed={activeStage === 'all'} className={activeStage === 'all' ? 'active' : ''} onClick={() => setActiveStage('all')}>全部 <small>{game.rules.length}</small></button>
        {stages.map((stage) => <button type="button" aria-pressed={activeStage === stage} key={stage} className={activeStage === stage ? 'active' : ''} onClick={() => setActiveStage(stage)}>{stageNames[stage]} <small>{game.rules.filter((rule) => rule.flowStage === stage).length}</small></button>)}
      </nav>
      {availableTags.length > 0 && <div className="tag-filter" aria-label="依主題篩選"><span>主題</span>{availableTags.map((tag) => <button type="button" aria-pressed={activeTag === tag} className={activeTag === tag ? 'tag-chip active' : 'tag-chip'} key={tag} onClick={() => setActiveTag((value) => value === tag ? '' : tag)}>#{tag}</button>)}</div>}
    </section>
    <div className="game-rules">
      {visibleRules.map((rule, index) => <Fragment key={rule.id}>
        <RuleCard rule={rule} onTagClick={setActiveTag} onEdit={canEdit ? () => setEditing(rule) : undefined} />
        {index === 3 && visibleRules.length > 5 && <AdSlot placement="game-rule-list" />}
      </Fragment>)}
      {visibleRules.length === 0 && <div className="empty-state"><p>找不到符合目前條件的規則。</p><button type="button" className="text-action" onClick={() => { setActiveStage('all'); setActiveTag(''); setRuleQuery(''); }}>清除篩選</button></div>}
    </div>
    {game.aliases.length > 1 && <aside className="alias-box"><strong>也可以用這些名稱找到</strong><p>{game.aliases.join('・')}</p></aside>}
    {editing && <RuleEditor rule={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await load(); }} />}
    {editingGame && <GameEditor game={game} onClose={() => setEditingGame(false)} onSaved={async () => { setEditingGame(false); await load(); }} />}
  </section>;
};

const RuleEditor = ({ rule, onClose, onSaved }: { rule: RuleCardType; onClose(): void; onSaved(): Promise<void> }) => {
  const { isAdmin } = useSession();
  const [statement, setStatement] = useState(rule.statement);
  const [commonMistake, setCommonMistake] = useState(rule.commonMistake ?? '');
  const [details, setDetails] = useState(rule.details ?? '');
  const [flowStage, setFlowStage] = useState(rule.flowStage);
  const [playerCountNote, setPlayerCountNote] = useState(rule.playerCountNote ?? '');
  const [editionNote, setEditionNote] = useState(rule.editionNote ?? '');
  const [isFeatured, setFeatured] = useState(rule.isFeatured);
  const [tagNames, setTagNames] = useState(rule.tags.map((tag) => tag.name));
  const [sourceLabel, setSourceLabel] = useState(rule.sourceLabel ?? '');
  const [sourceUrl, setSourceUrl] = useState(rule.sourceUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState<RuleRevision[]>();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = ''; };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      await api.patchRule(rule.id, { statement, commonMistake: commonMistake || null, details: details || null, flowStage, playerCountNote: playerCountNote || null, editionNote: editionNote || null, isFeatured, tagNames, sourceLabel: sourceLabel || null, sourceUrl: sourceUrl || null });
      await onSaved();
    } finally { setSaving(false); }
  };
  const hide = async () => { if (window.confirm('隱藏這條規則？之後仍可從管理頁恢復。')) { await api.hideRule(rule.id); await onSaved(); } };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-rule-title">
      <div className="modal-heading"><h2 id="edit-rule-title">編輯規則</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>規則結論<textarea rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
      <label>常見錯法<textarea rows={2} value={commonMistake} onChange={(event) => setCommonMistake(event.target.value)} /></label>
      <label>補充說明<textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <div className="two-columns"><label>流程位置<select value={flowStage} onChange={(event) => setFlowStage(event.target.value as FlowStage)}>{FLOW_STAGES.map((stage) => <option key={stage} value={stage}>{stageNames[stage]}</option>)}</select></label>
        <label>適用人數<input value={playerCountNote} onChange={(event) => setPlayerCountNote(event.target.value)} /></label></div>
      <label>版本／擴充<input value={editionNote} onChange={(event) => setEditionNote(event.target.value)} /></label>
      <TagInput value={tagNames} onChange={setTagNames} canCreate={isAdmin} />
      <div className="two-columns"><label>這批規則的來源<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} /></label><label>這批規則的來源網址<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label></div>
      <label className="checkbox"><input type="checkbox" checked={isFeatured} onChange={(event) => setFeatured(event.target.checked)} />首頁精選</label>
      <section className="revision-panel">
        <button type="button" className="text-action" onClick={() => void api.ruleRevisions(rule.id).then((data) => setRevisions(data.revisions))}>查看版本紀錄</button>
        {revisions && (revisions.length ? <div className="admin-list">{revisions.map((revision) => <div key={revision.id}>
          <span><strong>{revision.previousStatement}</strong><small>{new Date(revision.createdAt).toLocaleString('zh-TW')}・{revision.reason}</small></span>
          <button type="button" className="text-action" onClick={() => { if (window.confirm('恢復到這個版本？目前內容也會保留在版本紀錄中。')) void api.restoreRevision(rule.id, revision.id).then(onSaved); }}>恢復</button>
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
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-game-title">
      <div className="modal-heading"><h2 id="edit-game-title">編輯遊戲名稱</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>顯示名稱<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>英文名稱<input value={englishName} onChange={(event) => setEnglishName(event.target.value)} /></label>
      <label>可搜尋的別名（每行一個）<textarea rows={5} value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
      <div className="modal-actions"><span /><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={!displayName.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存遊戲'}</button></div></div>
    </div>
  </div>;
};
