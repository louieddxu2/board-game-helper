import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GameSearch, clearSearchCache } from '../components/GameSearch';
import { EditionInput } from '../components/EditionInput';
import { PlayerCountInput } from '../components/PlayerCountInput';
import { TagInput } from '../components/TagInput';
import { RuleCategoryInput } from '../components/RuleCategoryInput';
import { useSession } from '../context/SessionContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { ApiError, api } from '../lib/api';
import { collectEditionOptions, mergeEditionOptions } from '../lib/editionOptions';
import { localDb, type DraftRecord } from '../lib/localDb';
import { parseRuleDraftImport } from '../lib/ruleDraftImport';
import type { ContributionQuota, GameDetail, GameSummary, RuleCategory, SubmissionInput, TagSelection } from '../shared/types';

type RuleInput = {
  id: string;
  statement: string;
  commonMistake?: string;
  categories?: RuleCategory[];
  playerCounts?: number[];
  editionNotes?: string[];
  sourceLabel?: string;
  sourceUrl?: string;
  tagSelections?: TagSelection[];
  tagNames?: string[];
};

const blankRule = (): RuleInput => ({ id: crypto.randomUUID(), statement: '' });
export const AddPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, canEdit, isAdmin, loading } = useSession();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [game, setGame] = useState<GameSummary>();
  const [gameQuery, setGameQuery] = useState('');
  const [gameEditionOptions, setGameEditionOptions] = useState<{ gameId: string; options: string[] }>();
  const [englishName, setEnglishName] = useState('');
  const [rules, setRules] = useState<RuleInput[]>([blankRule()]);
  const [activeRuleId, setActiveRuleId] = useState(() => rules[0].id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string; englishName?: string }>>([]);
  const [quota, setQuota] = useState<ContributionQuota>();
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const selectedGameId = game?.id;
  const isGeneralContributor = Boolean(user && !canEdit);
  const remainingRules = quota?.remainingRules ?? 0;
  const remainingGames = quota?.remainingGames ?? 0;
  const quotaLimitMessage = '已達本次可新增上限，請查看右上方的投稿說明。';
  const gameSelectionMessage = '你目前無法建立新遊戲，請先選擇一款既有遊戲。詳情請查看右上方的投稿說明。';
  const ruleEntryLocked = isGeneralContributor && (!quota || remainingRules === 0 || (!game && remainingGames === 0));
  const ruleEntryMessage = !quota || remainingRules === 0 ? quotaLimitMessage : gameSelectionMessage;
  const maxRuleInputs = canEdit ? 20 : remainingRules;

  const selectGame = (selected: GameSummary) => {
    setGame(selected);
    setGameQuery(selected.displayName);
    setEnglishName(selected.englishName ?? '');
  };

  useEffect(() => {
    if (!user || canEdit) { setQuota(undefined); return; }
    let active = true;
    void api.contributions().then((data) => { if (active) setQuota(data.quota); }).catch(() => {
      if (active) setError('暫時無法讀取投稿額度，請稍後再試。');
    });
    return () => { active = false; };
  }, [user?.id, canEdit]);

  useEffect(() => {
    let active = true;
    void Promise.all([localDb.getDraft(), localDb.recentGames()]).then(async ([draft, recent]) => {
      if (!active) return;
      setRecentGames(recent);
      const hasDraft = Boolean(draft && (draft.game || draft.rules.some((rule) => rule.statement.trim())));
      if (draft && hasDraft) {
        setGame(draft.game ? { ...draft.game, ruleCount: 0, updatedAt: draft.updatedAt } : undefined);
        setGameQuery(draft.gameQuery);
        setEnglishName(draft.game?.englishName ?? draft.englishName ?? '');
        const restored = draft.rules.length ? draft.rules.map((rule) => ({
          ...rule,
          tagSelections: rule.tagSelections ?? rule.tagNames?.map((name) => ({ name })) ?? [],
          tagNames: undefined,
          editionNotes: rule.editionNotes ?? (rule.editionNote ? [rule.editionNote] : []),
          sourceLabel: rule.sourceLabel ?? draft.sourceLabel,
          sourceUrl: rule.sourceUrl ?? draft.sourceUrl,
        })) : [blankRule()];
        setRules(restored);
        setActiveRuleId(restored[0].id);
        return;
      }
      const requestedGame = searchParams.get('game');
      const nameParam = searchParams.get('name') || searchParams.get('gameName');
      if (requestedGame) {
        const response = await api.game(requestedGame, false);
        if (active) selectGame(response.game);
      } else if (nameParam) setGameQuery(nameParam);
    });
    return () => { active = false; };
  }, [searchParams]);

  useEffect(() => {
    if (!selectedGameId) { setGameEditionOptions(undefined); return; }
    let active = true;
    const gameId = selectedGameId;
    const applyOptions = ({ game: detail }: { game: GameDetail }) => {
      if (active) setGameEditionOptions({ gameId, options: collectEditionOptions(detail.rules) });
    };
    void api.game(gameId, canEdit, applyOptions).then(applyOptions).catch(() => undefined);
    return () => { active = false; };
  }, [selectedGameId, canEdit]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft: Omit<DraftRecord, 'id'> = {
        game: game ? { id: game.id, slug: game.slug, displayName: game.displayName, englishName: game.englishName } : undefined,
        gameQuery, englishName, rules, updatedAt: Date.now(),
      };
      void localDb.saveDraft(draft).then(() => setSavedAt(Date.now()));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [game, gameQuery, englishName, rules]);

  const validRules = useMemo(() => rules.filter((rule) => rule.statement.trim()), [rules]);
  const editionOptions = useMemo(() => mergeEditionOptions(
    selectedGameId && gameEditionOptions?.gameId === selectedGameId ? gameEditionOptions.options : [],
    collectEditionOptions(rules),
  ), [selectedGameId, gameEditionOptions, rules]);
  const setRule = (id: string, patch: Partial<RuleInput>) => {
    if (ruleEntryLocked) { showToast(ruleEntryMessage, 'info'); return; }
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  };
  const addRuleAfter = (id?: string) => {
    if (ruleEntryLocked) { showToast(ruleEntryMessage, 'info'); return; }
    if (isGeneralContributor && rules.length >= maxRuleInputs) { showToast(quotaLimitMessage, 'info'); return; }
    const next = blankRule();
    setRules((current) => {
      if (!id) return [...current, next];
      const index = current.findIndex((rule) => rule.id === id);
      return [...current.slice(0, index + 1), next, ...current.slice(index + 1)];
    });
    setActiveRuleId(next.id);
    window.setTimeout(() => inputRefs.current[next.id]?.focus(), 0);
  };
  const removeRule = (id: string) => {
    const remaining = rules.filter((rule) => rule.id !== id);
    const next = remaining.length ? remaining : (isGeneralContributor && maxRuleInputs === 0 ? [] : [blankRule()]);
    setRules(next);
    if (activeRuleId === id && next[0]) setActiveRuleId(next[0].id);
  };

  const importRuleDraft = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = parseRuleDraftImport(await file.text());
      if (validRules.length && !await confirm({ title: '取代目前草稿？', message: `匯入的 ${imported.rules.length} 條規則會取代目前內容。`, confirmLabel: '匯入草稿' })) return;
      const importedGame = imported.game.id && imported.game.slug ? {
        id: imported.game.id,
        slug: imported.game.slug,
        displayName: imported.game.displayName,
        englishName: imported.game.englishName,
        ruleCount: 0,
        updatedAt: Date.now(),
      } : undefined;
      const importedRules = imported.rules.map((rule) => ({ ...rule, id: crypto.randomUUID(), tagSelections: rule.tagNames?.map((name) => ({ name })) ?? [], tagNames: undefined }));
      setGame(importedGame); setGameQuery(imported.game.displayName); setEnglishName(imported.game.englishName ?? '');
      setRules(importedRules); setActiveRuleId(importedRules[0]?.id ?? blankRule().id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '無法匯入草稿。'); }
  };

  const submit = async () => {
    if (!user || validRules.length === 0 || saving || (!game && !gameQuery.trim())) return;
    if (isGeneralContributor && (validRules.length > remainingRules || (!game && remainingGames === 0))) {
      showToast(!game && remainingGames === 0 ? gameSelectionMessage : quotaLimitMessage, 'info');
      return;
    }
    setSaving(true); setError('');
    const payload: SubmissionInput = {
      ...(game ? { gameId: game.id } : { newGame: { displayName: gameQuery.trim(), englishName: englishName.trim() || undefined } }),
      idempotencyKey: crypto.randomUUID(),
      rules: validRules.map((rule) => ({
        statement: rule.statement.trim(), commonMistake: rule.commonMistake?.trim() || undefined,
        categories: rule.categories, playerCounts: rule.playerCounts, editionNotes: rule.editionNotes,
        sourceLabel: rule.sourceLabel?.trim() || undefined, sourceUrl: rule.sourceUrl?.trim() || undefined,
        tagIds: rule.tagSelections?.flatMap((tag) => tag.id ? [tag.id] : []),
        newTagNames: rule.tagSelections?.flatMap((tag) => tag.id ? [] : [tag.name]),
      })),
    };
    try {
      await localDb.addPending(user.id, payload);
      const result = await api.submit(payload);
      await Promise.all([localDb.removePending(payload.idempotencyKey), localDb.clearDraft(), localDb.invalidateHome(), localDb.invalidateGame(result.gameId)]);
      clearSearchCache();
      if (result.quota) setQuota(result.quota);
      const firstRule = result.ruleIds?.[0];
      navigate(`/games/${result.gameSlug}${firstRule ? `#rule-${firstRule}` : ''}`, { state: { justAdded: validRules.length, addedRuleIds: result.ruleIds ?? [] } });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PENDING_RULE_LIMIT_REACHED') setError(quotaLimitMessage);
      else if (caught instanceof ApiError && caught.code === 'PENDING_GAME_LIMIT_REACHED') setError(gameSelectionMessage);
      else if (caught instanceof ApiError && caught.status === 401) setError('登入狀態已失效，請重新登入後再送出。');
      else setError('尚未成功同步，內容已保留在這台裝置，請稍後再試。');
    } finally { setSaving(false); }
  };

  const requestSubmit = async () => {
    if (!game && gameQuery.trim() && !await confirm({ title: '建立新遊戲？', message: `將以「${gameQuery.trim()}」建立新遊戲並投稿規則。`, confirmLabel: '建立並投稿' })) return;
    await submit();
  };

  const handleCancel = async () => {
    const hasContent = validRules.some((rule) => rule.statement.trim() || rule.commonMistake?.trim()) || Boolean(game || gameQuery.trim());
    if (hasContent && !await confirm({ title: '離開草稿？', message: '草稿已自動儲存在這台裝置。', confirmLabel: '離開', cancelLabel: '繼續編輯', discardLabel: '捨棄草稿' })) return;
    navigate(-1);
  };

  if (!loading && !user) return <section className="add-page narrow-page">
    <header className="add-page-heading"><h1>記錄玩錯的規則</h1></header>
    <div className="account-card"><h2 style={{ marginTop: 0 }}>使用Google帳戶登入後即可填寫</h2><p>登入後可有限度地建立規則。</p><Link className="button primary" to="/login">登入</Link></div>
  </section>;

  return <section className="add-page narrow-page">
    <header className="add-page-heading"><h1>記錄玩錯的規則</h1><div className="add-page-actions">
      {isGeneralContributor && quota && <div className="add-page-quota" aria-label="投稿額度"><span>未審核規則 {quota.pendingRules} / {quota.ruleLimit}</span><span>未審核遊戲 {quota.pendingGames} / {quota.gameLimit}</span></div>}
      {isGeneralContributor && <Link className="text-action add-page-help-link" to="/contributions">投稿說明</Link>}
      {isAdmin && <label className="button secondary rule-draft-import">匯入 JSON<input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importRuleDraft(event)} /></label>}
    </div></header>
    <div className={game ? 'record-game-fields two-columns' : 'record-game-fields'}>
      <div className="record-game-name-field">
        <div className="field-label-row"><span>遊戲名稱 *</span>{game && <button type="button" className="text-action" onClick={() => { setGame(undefined); setEnglishName(''); }}>重新選擇</button>}</div>
        {game ? <input value={game.displayName} readOnly aria-label="遊戲名稱" /> : <GameSearch value={gameQuery} onChange={setGameQuery} onSelect={selectGame} placeholder="搜尋或輸入遊戲名稱" />}
      </div>
      <label>英文名稱<input value={englishName} readOnly={Boolean(game)} onChange={(event) => setEnglishName(event.target.value)} /></label>
    </div>
    {!game && recentGames.length > 0 && <div className="recent-game-chips"><span>最近查看</span>{recentGames.slice(0, 6).map((recent) => <button type="button" key={recent.id} onClick={() => selectGame({ ...recent, ruleCount: 0, updatedAt: Date.now() })}>{recent.displayName}</button>)}</div>}
    <div className="rule-input-list">
      <div className="list-heading"><h2>這次玩錯的規則</h2><span>{validRules.length} 條</span></div>
      {ruleEntryLocked ? <button type="button" className="rule-entry-gate" onClick={() => showToast(ruleEntryMessage, 'info')}>
        {remainingRules === 0 ? '目前沒有可投稿的規則額度' : '請先選擇一款既有遊戲'}
        <small>{remainingRules === 0 ? '請查看右上方的投稿說明。' : '目前無法建立新遊戲；詳情請查看右上方的投稿說明。'}</small>
      </button> : rules.map((rule, index) => {
        const active = activeRuleId === rule.id;
        return <div className={`rule-input ${active ? 'active' : 'collapsed'}`} key={rule.id}>
          <span className="rule-number">{index + 1}</span>
          {active ? <div className="rule-input-fields">
            <label htmlFor={`rule-${rule.id}`}>規則內容 *</label>
            <textarea id={`rule-${rule.id}`} ref={(node) => { inputRefs.current[rule.id] = node; }} rows={2} value={rule.statement} onChange={(event) => setRule(rule.id, { statement: event.target.value })} onKeyDown={(event) => {
              const mobile = window.matchMedia('(max-width: 800px), (pointer: coarse)').matches;
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !mobile && rule.statement.trim()) { event.preventDefault(); addRuleAfter(rule.id); }
            }} />
            <label>玩錯情況<textarea rows={2} value={rule.commonMistake ?? ''} onChange={(event) => setRule(rule.id, { commonMistake: event.target.value })} /></label>
            <TagInput value={rule.tagSelections ?? []} onChange={(tagSelections) => setRule(rule.id, { tagSelections })} canCreate={isAdmin} label="標籤" detectionInput={{ statement: rule.statement, commonMistake: rule.commonMistake, details: '' }} />
            <RuleCategoryInput value={rule.categories ?? []} onChange={(categories) => setRule(rule.id, { categories })} />
            <PlayerCountInput value={rule.playerCounts ?? []} onChange={(playerCounts) => setRule(rule.id, { playerCounts })} />
            <EditionInput value={rule.editionNotes ?? []} options={editionOptions} onChange={(editionNotes) => setRule(rule.id, { editionNotes })} />
            <div className="two-columns"><label>來源名稱<input value={rule.sourceLabel ?? ''} onChange={(event) => setRule(rule.id, { sourceLabel: event.target.value })} /></label><label>資料網址<input type="url" value={rule.sourceUrl ?? ''} onChange={(event) => setRule(rule.id, { sourceUrl: event.target.value })} /></label></div>
          </div> : <button type="button" className="rule-input-summary" onClick={() => { setActiveRuleId(rule.id); window.setTimeout(() => inputRefs.current[rule.id]?.focus(), 0); }}>{rule.statement.trim() || '新增規則內容'}</button>}
          <button type="button" className="remove-button" onClick={() => removeRule(rule.id)} aria-label={`移除第 ${index + 1} 條`}>×</button>
        </div>;
      })}
      <button type="button" className="add-row-button" onClick={() => addRuleAfter()}>＋新增一條規則</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="sticky-submit"><button type="button" className="button secondary mobile-cancel-btn" onClick={() => void handleCancel()}>取消</button><p className="submit-info-text">{savedAt ? `草稿已儲存於 ${new Date(savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}` : `目前 ${validRules.length} 條規則`}</p><button className="button primary save-button" type="button" disabled={(!game && !gameQuery.trim()) || validRules.length === 0 || saving || ruleEntryLocked} onClick={() => void requestSubmit()}>{saving ? '送出中…' : `送出 ${validRules.length} 條規則`}</button></div>
  </section>;
};
