import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GameSearch } from '../components/GameSearch';
import { TagInput } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { ApiError, api } from '../lib/api';
import { localDb, type DraftRecord } from '../lib/localDb';
import type { GameSummary, SubmissionInput } from '../shared/types';

type RuleInput = { id: string; statement: string; commonMistake?: string; tagNames?: string[] };
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
  const [game, setGame] = useState<GameSummary>();
  const [gameQuery, setGameQuery] = useState('');
  const [rules, setRules] = useState<RuleInput[]>([blankRule()]);
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [playedOn, setPlayedOn] = useState(today());
  const [privateNote, setPrivateNote] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string }>>([]);
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  useEffect(() => {
    let active = true;
    void Promise.all([localDb.getDraft(), localDb.recentGames()]).then(async ([draft, recent]) => {
      if (!active) return;
      setRecentGames(recent);
      const hasDraft = Boolean(draft && (draft.game || draft.rules.some((rule) => rule.statement.trim())));
      if (draft && hasDraft) {
        setGame(draft.game ? { ...draft.game, ruleCount: 0, updatedAt: draft.updatedAt } : undefined);
        setGameQuery(draft.gameQuery);
        setRules(draft.rules.length ? draft.rules : [blankRule()]);
        setSourceLabel(draft.sourceLabel); setSourceUrl(draft.sourceUrl);
        setPlayedOn(draft.playedOn || today()); setPrivateNote(draft.privateNote);
        return;
      }
      const requestedGame = searchParams.get('game');
      if (requestedGame) {
        const response = await api.game(requestedGame, true);
        if (!active) return;
        setGame(response.game); setGameQuery(response.game.displayName);
        window.setTimeout(() => inputRefs.current[rules[0].id]?.focus(), 0);
      }
    });
    return () => { active = false; };
  }, [searchParams]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft: Omit<DraftRecord, 'id'> = {
        game: game ? { id: game.id, slug: game.slug, displayName: game.displayName } : undefined,
        gameQuery, rules, sourceLabel, sourceUrl, playedOn, privateNote, updatedAt: Date.now(),
      };
      void localDb.saveDraft(draft).then(() => setSavedAt(Date.now()));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [game, gameQuery, rules, sourceLabel, sourceUrl, playedOn, privateNote]);
  const validRules = useMemo(() => rules.filter((rule) => rule.statement.trim()), [rules]);
  const setRule = (id: string, patch: Partial<RuleInput>) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  const addRuleAfter = (id?: string) => {
    const next = blankRule();
    setRules((current) => {
      if (!id) return [...current, next];
      const index = current.findIndex((rule) => rule.id === id);
      return [...current.slice(0, index + 1), next, ...current.slice(index + 1)];
    });
    window.setTimeout(() => inputRefs.current[next.id]?.focus(), 0);
  };
  const removeRule = (id: string) => setRules((current) => current.length === 1 ? [blankRule()] : current.filter((rule) => rule.id !== id));
  const createGame = async (name: string) => {
    try {
      const response = await api.createGame({ displayName: name });
      setGame(response.game); setGameQuery(response.game.displayName);
    } catch { setError('無法建立遊戲，請稍後再試。'); }
  };
  const submit = async () => {
    if (!game || validRules.length === 0 || saving) return;
    setSaving(true); setError('');
    const payload: SubmissionInput = {
      gameId: game.id,
      playedOn,
      sourceLabel: sourceLabel.trim() || undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      privateNote: privateNote.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
      rules: validRules.map((rule) => ({ statement: rule.statement.trim(), commonMistake: rule.commonMistake?.trim() || undefined, tagNames: rule.tagNames })),
    };
    await localDb.addPending(payload);
    try {
      await api.submit(payload);
      await Promise.all([localDb.removePending(payload.idempotencyKey), localDb.clearDraft()]);
      navigate(`/games/${game.slug}`, { state: { justAdded: validRules.length } });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? '登入已過期，草稿已保留，請重新登入。' : '尚未成功同步；內容已保存在這台裝置。');
    } finally { setSaving(false); }
  };
  if (!loading && !canEdit) return <section className="narrow-page"><h1>需要編輯權限</h1><p>此頁只開放給已授權的編輯者。</p></section>;
  return <section className="add-page narrow-page">
    <header><p className="eyebrow">快速記錄</p><h1>這次玩錯了什麼？</h1></header>
    <GameSearch value={gameQuery} selectedId={game?.id} allowCreate onChange={(value) => { setGameQuery(value); if (game && value !== game.displayName) setGame(undefined); }}
      onSelect={(selected) => { setGame(selected); setGameQuery(selected.displayName); }} onCreate={(name) => void createGame(name)} />
    {!game && recentGames.length > 0 && <div className="recent-game-chips"><span>最近查看</span>{recentGames.slice(0, 6).map((recent) => <button type="button" key={recent.id} onClick={() => { setGame({ ...recent, ruleCount: 0, updatedAt: Date.now() }); setGameQuery(recent.displayName); }}>{recent.displayName}</button>)}</div>}
    {game && <div className="rule-input-list">
      <div className="list-heading"><h2>本次發現的錯誤</h2><span>{validRules.length} 條</span></div>
      {rules.map((rule, index) => <div className="rule-input" key={rule.id}>
        <span className="rule-number">{index + 1}</span>
        <div>
          <label className="sr-only" htmlFor={`rule-${rule.id}`}>第 {index + 1} 條規則</label><textarea id={`rule-${rule.id}`} ref={(node) => { inputRefs.current[rule.id] = node; }} rows={2} value={rule.statement} aria-keyshortcuts="Enter Shift+Enter"
            placeholder="例如：三人局起始只有 5 個方塊，不是 7 個。"
            onChange={(event) => setRule(rule.id, { statement: event.target.value })}
            onKeyDown={(event) => {
              const usesMobileEntry = window.matchMedia('(max-width: 800px), (pointer: coarse)').matches;
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !usesMobileEntry && rule.statement.trim()) { event.preventDefault(); addRuleAfter(rule.id); }
            }} />
          <details><summary>常見錯法</summary><textarea rows={2} value={rule.commonMistake ?? ''}
            aria-label={`第 ${index + 1} 條的常見錯法`} placeholder="我們當時怎麼玩錯？" onChange={(event) => setRule(rule.id, { commonMistake: event.target.value })} />
            <TagInput value={rule.tagNames ?? []} onChange={(tagNames) => setRule(rule.id, { tagNames })} canCreate={isAdmin} /></details>
        </div>
        <button type="button" className="remove-button" onClick={() => removeRule(rule.id)} aria-label={`刪除第 ${index + 1} 條`}>×</button>
      </div>)}
      <button type="button" className="add-row-button" onClick={() => addRuleAfter()}>＋新增下一條</button>
    </div>}
    {game && <div className="shared-fields">
      <label>共同來源<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="例如：官方英文說明書第 8 頁" /></label>
      <label>來源網址<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></label>
      <button type="button" className="text-action" onClick={() => setShowMore((value) => !value)}>{showMore ? '收起其他資料' : '遊玩日期與私人備註'}</button>
      {showMore && <div className="more-fields"><label>遊玩日期<input type="date" value={playedOn} onChange={(event) => setPlayedOn(event.target.value)} /></label>
        <label>私人備註<textarea rows={2} value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} /></label></div>}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="sticky-submit"><p>{savedAt ? `已自動保存 ${new Date(savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}` : `${game ? game.displayName : '先選擇遊戲'}・${validRules.length} 條可儲存`}</p>
      <button className="button primary" type="button" disabled={!game || validRules.length === 0 || saving} onClick={() => void submit()}>{saving ? '儲存中…' : `儲存 ${validRules.length} 條規則`}</button></div>
  </section>;
};
