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
  const [draft, setDraft] = useState<UncertainRuleDraft>(EMPTY_UNCERTAIN_RULE_DRAFT);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectGame = (selected: GameSummary) => {
    const { matchedVariantName, ...baseGame } = selected;
    setGame(baseGame);
    setGameQuery(baseGame.displayName);
    // Searching an expansion selects its base game; keep the expansion as the edition.
    if (matchedVariantName) setDraft((current) => current.editionNotes.length ? current : { ...current, editionNotes: [matchedVariantName] });
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

  const save = async () => {
    const typed = gameQuery.trim();
    if (!draft.question.trim() || (!game && !typed)) return;
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
        { ...uncertainRuleInput(draft), checked },
      );
      showToast(response.gameCreated ? '已建立遊戲並記下不確定的規則' : '已記下不確定的規則');
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
      <UncertainRuleFields value={draft} onChange={setDraft} editionOptions={editionOptions} variants={detail?.variants ?? []} />
      <label className="checkbox-row"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />已查過，沒找到答案</label>
    </div>
    <div className="sticky-submit">
      <button type="button" className="button secondary mobile-cancel-btn" onClick={() => navigate(-1)}>取消</button>
      <p className="submit-info-text">只有管理員看得到不確定的規則。</p>
      <button className="button primary save-button" type="button" disabled={saving || !draft.question.trim() || (!game && !gameQuery.trim())} onClick={() => void save()}>{saving ? '儲存中…' : '儲存'}</button>
    </div>
  </section>;
};
