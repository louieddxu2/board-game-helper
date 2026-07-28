import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GameSearch, clearSearchCache } from '../components/GameSearch';
import { EditionInput } from '../components/EditionInput';
import { PlayerCountInput } from '../components/PlayerCountInput';
import { TagInput } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { useConfirm } from '../context/ConfirmContext';
import { ApiError, api } from '../lib/api';
import { collectEditionOptions, mergeEditionOptions } from '../lib/editionOptions';
import { localDb, type DraftRecord } from '../lib/localDb';
import type { GameSummary, SubmissionInput } from '../shared/types';

type RuleInput = { id: string; statement: string; commonMistake?: string; playerCounts?: number[]; editionNotes?: string[]; sourceLabel?: string; sourceUrl?: string; tagNames?: string[] };
const blankRule = (): RuleInput => ({ id: crypto.randomUUID(), statement: '' });
const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export const AddPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { canEdit, isAdmin, loading } = useSession();
  const { confirm } = useConfirm();
  const [game, setGame] = useState<GameSummary>();
  const [gameQuery, setGameQuery] = useState('');
  const [gameEditionOptions, setGameEditionOptions] = useState<{ gameId: string; options: string[] }>();
  const [englishName, setEnglishName] = useState('');
  const [rules, setRules] = useState<RuleInput[]>([blankRule()]);
  const [activeRuleId, setActiveRuleId] = useState(() => rules[0].id);
  const [playedOn, setPlayedOn] = useState(today());
  const [privateNote, setPrivateNote] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string; englishName?: string }>>([]);
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const selectedGameId = game?.id;
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
        const restoredRules = draft.rules.length ? draft.rules.map((rule) => ({
          ...rule,
          editionNotes: rule.editionNotes ?? (rule.editionNote ? [rule.editionNote] : []),
          sourceLabel: rule.sourceLabel ?? draft.sourceLabel,
          sourceUrl: rule.sourceUrl ?? draft.sourceUrl,
        })) : [blankRule()];
        setRules(restoredRules);
        setActiveRuleId(restoredRules[0].id);
        setPlayedOn(draft.playedOn || today()); setPrivateNote(draft.privateNote);
        return;
      }
      const requestedGame = searchParams.get('game');
      const nameParam = searchParams.get('name') || searchParams.get('gameName');
      if (requestedGame) {
        const response = await api.game(requestedGame);
        if (!active) return;
        setGame(response.game); setGameQuery(response.game.displayName); setEnglishName(response.game.englishName ?? '');
        window.setTimeout(() => inputRefs.current[rules[0].id]?.focus(), 0);
      } else if (nameParam && (!draft || !draft.gameQuery)) {
        setGameQuery(nameParam);
      }
    });
    return () => { active = false; };
  }, [searchParams]);
  useEffect(() => {
    if (!selectedGameId) { setGameEditionOptions(undefined); return; }
    let active = true;
    const gameId = selectedGameId;
    setGameEditionOptions((current) => current?.gameId === gameId ? current : { gameId, options: [] });
    void api.game(gameId, true).then(({ game: detail }) => {
      if (active) setGameEditionOptions({ gameId, options: collectEditionOptions(detail.rules) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selectedGameId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft: Omit<DraftRecord, 'id'> = {
        game: game ? { id: game.id, slug: game.slug, displayName: game.displayName, englishName: game.englishName } : undefined,
        gameQuery, englishName, rules, playedOn, privateNote, updatedAt: Date.now(),
      };
      void localDb.saveDraft(draft).then(() => setSavedAt(Date.now()));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [englishName, game, gameQuery, rules, playedOn, privateNote]);
  const validRules = useMemo(() => rules.filter((rule) => rule.statement.trim()), [rules]);
  const editionOptions = useMemo(() => mergeEditionOptions(
    selectedGameId && gameEditionOptions?.gameId === selectedGameId ? gameEditionOptions.options : [],
    collectEditionOptions(rules),
  ), [selectedGameId, gameEditionOptions, rules]);
  const setRule = (id: string, patch: Partial<RuleInput>) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  const addRuleAfter = (id?: string) => {
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
    const nextRules = remaining.length ? remaining : [blankRule()];
    setRules(nextRules);
    if (activeRuleId === id) setActiveRuleId(nextRules[0].id);
  };
  const submit = async () => {
    if (validRules.length === 0 || saving || (!game && !gameQuery.trim())) return;
    setSaving(true); setError('');
    try {
      let targetGame = game;
      if (!targetGame) {
        const response = await api.createGame({ displayName: gameQuery.trim(), englishName: englishName.trim() || undefined });
        targetGame = response.game;
        setGame(targetGame);
        setGameQuery(targetGame.displayName);
        setEnglishName(targetGame.englishName ?? '');
      }
      const payload: SubmissionInput = {
        gameId: targetGame.id,
        playedOn,
        privateNote: privateNote.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
        rules: validRules.map((rule) => ({ statement: rule.statement.trim(), commonMistake: rule.commonMistake?.trim() || undefined, playerCounts: rule.playerCounts, editionNotes: rule.editionNotes, sourceLabel: rule.sourceLabel?.trim() || undefined, sourceUrl: rule.sourceUrl?.trim() || undefined, tagNames: rule.tagNames })),
      };
      await localDb.addPending(payload);
      const result = await api.submit(payload);
      await Promise.all([
        localDb.removePending(payload.idempotencyKey), localDb.clearDraft(),
      ]);
      await localDb.invalidateHome();
      clearSearchCache();
      if (targetGame.slug) {
        await localDb.invalidateGame(targetGame.slug);
      }
      const firstRule = result.ruleIds?.[0];
      navigate(`/games/${targetGame.slug}${firstRule ? `#rule-${firstRule}` : ''}`, {
        state: { justAdded: validRules.length, addedRuleIds: result.ruleIds ?? [] },
      });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? '登入已過期，草稿已保留，請重新登入。' : '尚未成功同步；內容已保存在這台裝置。');
    } finally { setSaving(false); }
  };
  const requestSubmit = async () => {
    if (!game) {
      const name = gameQuery.trim();
      if (!name) return;
      const confirmed = await confirm({
        title: '建立新遊戲？',
        message: `你的遊戲名稱「${name}」尚不在資料庫中，確定要創建新的遊戲條目嗎？`,
        confirmLabel: '建立遊戲',
      });
      if (!confirmed) return;
    }
    await submit();
  };
  if (!loading && !canEdit) return <section className="narrow-page"><h1>需要編輯權限</h1><p>此頁只開放給已授權的編輯者。</p></section>;
  return <section className="add-page narrow-page">
    <header><h1>記錄玩錯的規則</h1></header>
    <div className="record-game-fields">
      <div className="record-game-name-field">
        <div className="field-label-row"><span>遊戲名稱 *</span>{game && <button type="button" className="text-action" onClick={() => { setGame(undefined); setEnglishName(''); window.setTimeout(() => document.querySelector<HTMLInputElement>('.record-game-name-field input')?.focus(), 0); }}>編輯</button>}</div>
        {game
          ? <input value={game.displayName} readOnly aria-label="遊戲名稱" />
          : <GameSearch value={gameQuery} onChange={setGameQuery}
              onSelect={(selected) => { setGame(selected); setGameQuery(selected.displayName); setEnglishName(selected.englishName ?? ''); }} placeholder="遊戲名稱" />}
      </div>
      <label>英文名稱<input value={englishName} readOnly={Boolean(game)} aria-readonly={Boolean(game)} onChange={(event) => setEnglishName(event.target.value)} /></label>
    </div>
    {!game && recentGames.length > 0 && <div className="recent-game-chips"><span>最近查看</span>{recentGames.slice(0, 6).map((recent) => <button type="button" key={recent.id} onClick={() => { setGame({ ...recent, ruleCount: 0, updatedAt: Date.now() }); setGameQuery(recent.displayName); setEnglishName(recent.englishName ?? ''); }}>{recent.displayName}</button>)}</div>}
    <div className="rule-input-list">
      <div className="list-heading"><h2>本次發現的錯誤</h2><span>{validRules.length} 條</span></div>
      {rules.map((rule, index) => {
        const active = activeRuleId === rule.id;
        return <div className={`rule-input ${active ? 'active' : 'collapsed'}`} key={rule.id}>
        <span className="rule-number">{index + 1}</span>
        {active ? <div className="rule-input-fields">
          <label htmlFor={`rule-${rule.id}`}>正確規則 *</label>
          <textarea id={`rule-${rule.id}`} ref={(node) => { inputRefs.current[rule.id] = node; }} rows={2} value={rule.statement} aria-keyshortcuts="Enter Shift+Enter"
            placeholder="例如：三人局起始只有 5 個方塊，不是 7 個。"
            onChange={(event) => setRule(rule.id, { statement: event.target.value })}
            onKeyDown={(event) => {
              const usesMobileEntry = window.matchMedia('(max-width: 800px), (pointer: coarse)').matches;
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !usesMobileEntry && rule.statement.trim()) { event.preventDefault(); addRuleAfter(rule.id); }
            }} />
          <label>玩錯情況<textarea rows={2} value={rule.commonMistake ?? ''}
            placeholder="我們當時怎麼玩錯？" onChange={(event) => setRule(rule.id, { commonMistake: event.target.value })} /></label>
          <TagInput value={rule.tagNames ?? []} onChange={(tagNames) => setRule(rule.id, { tagNames })} canCreate={isAdmin} label="標籤" detectionInput={{ statement: rule.statement, commonMistake: rule.commonMistake, details: '' }} />
          <PlayerCountInput value={rule.playerCounts ?? []} onChange={(playerCounts) => setRule(rule.id, { playerCounts })} />
          <EditionInput value={rule.editionNotes ?? []} options={editionOptions}
            onChange={(editionNotes) => setRule(rule.id, { editionNotes })} />
          <div className="two-columns"><label>參考資料<input value={rule.sourceLabel ?? ''} onChange={(event) => setRule(rule.id, { sourceLabel: event.target.value })} /></label><label>資料網址<input type="url" value={rule.sourceUrl ?? ''} onChange={(event) => setRule(rule.id, { sourceUrl: event.target.value })} placeholder="https://…" /></label></div>
        </div> : <button type="button" className="rule-input-summary" onClick={() => { setActiveRuleId(rule.id); window.setTimeout(() => inputRefs.current[rule.id]?.focus(), 0); }}>
          {rule.statement.trim() || '尚未輸入正確規則'}
        </button>}
        <button type="button" className="remove-button" onClick={() => removeRule(rule.id)} aria-label={`刪除第 ${index + 1} 條`}>×</button>
      </div>})}
      <button type="button" className="add-row-button" onClick={() => addRuleAfter()}>＋新增下一條</button>
    </div>
    {game && <div className="shared-fields">
      <button type="button" className="text-action" onClick={() => setShowMore((value) => !value)}>{showMore ? '收起其他資料' : '遊玩日期與私人備註'}</button>
      {showMore && <div className="more-fields"><label>遊玩日期<input type="date" value={playedOn} onChange={(event) => setPlayedOn(event.target.value)} /></label>
        <label>私人備註<textarea rows={2} value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} /></label></div>}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="sticky-submit"><p>{savedAt ? `已自動保存 ${new Date(savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}` : `${game ? game.displayName : gameQuery.trim() ? `待建立：${gameQuery.trim()}` : '請先輸入遊戲名稱'}・${validRules.length} 條可儲存`}</p>
      <button className="button primary" type="button" disabled={(!game && !gameQuery.trim()) || validRules.length === 0 || saving} onClick={() => void requestSubmit()}>{saving ? '儲存中…' : `儲存 ${validRules.length} 條規則`}</button></div>
  </section>;
};
