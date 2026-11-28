import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GameSearch } from '../components/GameSearch';
import { EMPTY_UNCERTAIN_RULE_DRAFT, UncertainRuleFields, uncertainRuleInput, type UncertainRuleDraft } from '../components/UncertainRuleFields';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../lib/api';
import { collectEditionOptions } from '../lib/editionOptions';
import { exactGameNameMatch } from '../lib/gameCatalog';
import { sitePageTitle } from '../lib/gameSeo';
import { uncertainRulesApi } from '../lib/uncertainRulesApi';
import type { GameDetail, GameSummary } from '../shared/types';

interface UncertainEntry { id: string; draft: UncertainRuleDraft; checked: boolean }
let entrySequence = 0;
const blankEntry = (): UncertainEntry => ({ id: `uncertain-entry-${entrySequence += 1}`, draft: EMPTY_UNCERTAIN_RULE_DRAFT, checked: false });

/** 記錄不確定的規則: the uncertain mode's record page, laid out like the page for a wrong rule. */
export const UncertainAddPage = () => {
  usePageTitle(sitePageTitle('記錄不確定的規則'));
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [game, setGame] = useState<GameSummary>();
  const [gameQuery, setGameQuery] = useState(searchParams.get('name') ?? '');
  const [englishName, setEnglishName] = useState('');
  const [detail, setDetail] = useState<GameDetail>();
  const [entries, setEntries] = useState<UncertainEntry[]>(() => [blankEntry()]);
  const [activeId, setActiveId] = useState(() => entries[0].id);
  // Only an entry the admin just opened or added takes focus; the page itself opens without a keyboard.
  const [focusId, setFocusId] = useState<string>();
  const [saving, setSaving] = useState(false);

  const selectGame = (selected: GameSummary) => {
    const { matchedVariantName, ...baseGame } = selected;
    setGame(baseGame);
    setGameQuery(baseGame.displayName);
    // Searching an expansion selects its base game; keep the expansion as the edition.
    if (matchedVariantName) setEntries((current) => current.map((entry) => entry.draft.editionNotes.length ? entry : { ...entry, draft: { ...entry.draft, editionNotes: [matchedVariantName] } }));
  };

  useEffect(() => {
    const requested = searchParams.get('game');
    if (!requested) return;
    let active = true;
    void api.game(requested, false).then(({ game: found }) => { if (active) selectGame(found); }).catch(() => undefined);
    return () => { active = false; };
  }, [searchParams]);

  useEffect(() => {
    setDetail(undefined);
    if (!game) return;
    let active = true;
    void api.game(game.id, false).then(({ game: found }) => { if (active) setDetail(found); }).catch(() => undefined);
    return () => { active = false; };
  }, [game?.id]);
  const editionOptions = useMemo(() => collectEditionOptions(detail?.rules ?? []), [detail]);

  const validEntries = entries.filter((entry) => entry.draft.question.trim());
  const setEntry = (id: string, patch: Partial<UncertainEntry>) => setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  const open = (id: string) => { setActiveId(id); setFocusId(id); };
  const addEntry = () => {
    const next = blankEntry();
    setEntries((current) => [...current, next]);
    open(next.id);
  };
  const removeEntry = (id: string) => {
    const remaining = entries.filter((entry) => entry.id !== id);
    const next = remaining.length ? remaining : [blankEntry()];
    setEntries(next);
    if (activeId === id) setActiveId(next[0].id);
  };

  const save = async () => {
    const typed = gameQuery.trim();
    if (!validEntries.length || (!game && !typed)) return;
    let target = game;
    if (!target) {
      // A typed catalog name selects that game; only a name the catalog lacks creates a new game.
      try { target = exactGameNameMatch((await api.searchGames(typed, undefined, { includeGamesWithoutPublishedRules: true })).games, typed); }
      catch { target = undefined; }
      if (target) { selectGame(target); showToast(`已選擇既有遊戲「${target.displayName}」，請確認後再儲存。`, 'info'); return; }
      if (!await confirm({ title: '建立新遊戲？', message: `將以「${typed}」建立新遊戲。在記下玩錯的規則之前，它不會出現在網站的搜尋與列表裡。`, confirmLabel: '建立並儲存' })) return;
    }
    setSaving(true);
    try {
      const response = await uncertainRulesApi.create(
        target ? { gameId: target.id } : { newGame: { displayName: typed, ...(englishName.trim() ? { englishName: englishName.trim() } : {}) } },
        validEntries.map((entry) => ({ ...uncertainRuleInput(entry.draft), checked: entry.checked })),
      );
      const count = response.uncertainRules.length;
      showToast(response.gameCreated ? `已建立遊戲並記下 ${count} 題不確定的規則` : `已記下 ${count} 題不確定的規則`);
      navigate(`/games/${encodeURIComponent(response.gameSlug)}`);
    } catch { showToast('儲存失敗，請稍後再試。', 'error'); }
    finally { setSaving(false); }
  };

  return <section className="add-page narrow-page uncertain-add-page">
    <header className="add-page-heading"><h1>記錄不確定的規則</h1></header>
    <div className={game ? 'record-game-fields two-columns' : 'record-game-fields'}>
      <div className="record-game-name-field">
        <div className="field-label-row"><span>遊戲名稱 *</span>{game && <button type="button" className="text-action" onClick={() => { setGame(undefined); setEnglishName(''); }}>重新選擇</button>}</div>
        {game ? <input value={game.displayName} readOnly aria-label="遊戲名稱" /> : <GameSearch value={gameQuery} onChange={setGameQuery} onSelect={selectGame} includeGamesWithoutPublishedRules placeholder="搜尋或輸入遊戲名稱" />}
      </div>
      {game ? game.englishName && <label>英文名稱<input value={game.englishName} readOnly /></label>
        : gameQuery.trim() && <label>英文名稱（新遊戲可填）<input value={englishName} onChange={(event) => setEnglishName(event.target.value)} /></label>}
    </div>
    <div className="rule-input-list">
      <div className="list-heading"><h2>這次不確定的規則</h2><span>{validEntries.length} 題</span></div>
      {entries.map((entry, index) => <div className={`rule-input ${entry.id === activeId ? 'active' : 'collapsed'}`} key={entry.id}>
        <span className="rule-number">{index + 1}</span>
        {entry.id === activeId ? <div className="uncertain-entry-fields">
          <UncertainRuleFields value={entry.draft} onChange={(draft) => setEntry(entry.id, { draft })} editionOptions={editionOptions} variants={detail?.variants ?? []} autoFocus={entry.id === focusId} />
          <label className="checkbox-row"><input type="checkbox" checked={entry.checked} onChange={(event) => setEntry(entry.id, { checked: event.target.checked })} />已查過BGG無答案</label>
        </div> : <button type="button" className="rule-input-summary" onClick={() => open(entry.id)}>{entry.draft.question.trim() || '新增不確定的問題'}</button>}
        <button type="button" className="remove-button" onClick={() => removeEntry(entry.id)} aria-label={`移除第 ${index + 1} 題`}>×</button>
      </div>)}
      <button type="button" className="add-row-button" onClick={addEntry}>＋新增一題</button>
    </div>
    <div className="sticky-submit">
      <button type="button" className="button secondary mobile-cancel-btn" onClick={() => navigate(-1)}>取消</button>
      <p className="submit-info-text">只有管理員看得到不確定的規則。</p>
      <button className="button primary save-button" type="button" disabled={saving || !validEntries.length || (!game && !gameQuery.trim())} onClick={() => void save()}>{saving ? '儲存中…' : `儲存 ${validEntries.length} 題`}</button>
    </div>
  </section>;
};
