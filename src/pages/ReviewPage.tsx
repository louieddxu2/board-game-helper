import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { GameSearch, clearSearchCache } from '../components/GameSearch';
import { EditionInput } from '../components/EditionInput';
import { PlayerCountInput } from '../components/PlayerCountInput';
import { RuleCategoryInput } from '../components/RuleCategoryInput';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { FLOW_STAGES, type FlowStage, type GameSummary, type ReviewBatch, type ReviewContent, type ReviewProposal } from '../shared/types';
import zhTWCopy from '../content/zh-TW.json';

const stageNames: Record<FlowStage, string> = {
  setup: '設置', round: '回合／輪次', action: '行動', end_scoring: '結束與計分',
  edition_player_count: '版本／人數', always: '全程適用', uncategorized: '未分類',
};
const value = (input: string | null | undefined) => input ?? '';

export const ReviewPage = () => {
  const { isAdmin, loading } = useSession();
  const [game, setGame] = useState<GameSummary>();
  const [gameQuery, setGameQuery] = useState('');
  const [flowStage, setFlowStage] = useState('');
  const [tag, setTag] = useState('');
  const [missingSource, setMissingSource] = useState(false);
  const [updatedAfter, setUpdatedAfter] = useState('');
  const [limit, setLimit] = useState('100');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    format: 'json' | 'csv';
    data: unknown;
    itemCount?: number;
    changedCount?: number;
  }>();
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [status, setStatus] = useState('pending');
  const [proposals, setProposals] = useState<ReviewProposal[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewContent>>({});
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'reject'>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (nextStatus = status, nextBatchId = batchId) => {
    const [batchData, proposalData] = await Promise.all([api.reviewBatches(), api.reviewProposals(nextStatus, nextBatchId, 30)]);
    setBatches(batchData.batches);
    setProposals(proposalData.proposals);
    setNextCursor(proposalData.nextCursor);
    setDrafts(Object.fromEntries(proposalData.proposals.map((proposal) => [proposal.id, proposal.proposed])));
    setDecisions({});
  };
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, status, batchId]);

  const loadMore = async () => {
    if (!nextCursor || busy) return;
    setBusy(true);
    try {
      const data = await api.reviewProposals(status, batchId, 30, nextCursor);
      setProposals((current) => [...current, ...data.proposals]);
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(data.proposals.map((proposal) => [proposal.id, proposal.proposed])),
      }));
      setNextCursor(data.nextCursor);
    } finally {
      setBusy(false);
    }
  };

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({ limit });
    if (game) params.set('gameId', game.id);
    if (flowStage) params.set('flowStage', flowStage);
    if (tag.trim()) params.set('tag', tag.trim());
    if (missingSource) params.set('missingSource', '1');
    if (updatedAfter) params.set('updatedAfter', String(new Date(`${updatedAfter}T00:00:00`).getTime()));
    return `/api/admin/review/export?${params}`;
  }, [game, flowStage, tag, missingSource, updatedAfter, limit]);

  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.csv')) {
        setSelectedFile({ name: file.name, format: 'csv', data: await file.text() });
        setMessage('');
        return;
      }
      const data = JSON.parse(await file.text()) as { format?: string; items?: Array<{ action?: string }> };
      if (data.format !== 'wrong-board-game-rules-review' || !Array.isArray(data.items)) throw new Error();
      setSelectedFile({
        name: file.name, format: 'json', data, itemCount: data.items.length,
        changedCount: data.items.filter((item) => item.action === 'propose' || item.action === 'hide').length,
      });
      setMessage('');
    } catch {
      setSelectedFile(undefined);
      setMessage('無法辨識這份校稿檔。');
    }
  };

  const importFile = async () => {
    if (!selectedFile) return;
    setBusy(true);
    try {
      const result = selectedFile.format === 'csv'
        ? await api.importReviewCsv(selectedFile.data as string)
        : await api.importReviewFile(selectedFile.data);
      setMessage(result.reused ? `這份檔案已匯入，共 ${result.imported} 項提案。`
        : `已匯入 ${result.imported} 項提案，${result.conflicts ?? 0} 項需要處理衝突。`);
      setSelectedFile(undefined);
      setStatus('pending');
      setBatchId(result.batchId);
      await load('pending', result.batchId);
    } catch {
      setMessage('匯入失敗；檔案可能已過期或格式不完整。');
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (id: string, patch: Partial<ReviewContent>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setDecisions((current) => ({ ...current, [id]: 'accept' }));
  };

  const submitDecisions = async () => {
    const queued = proposals.filter((proposal) => decisions[proposal.id]);
    if (!queued.length) return;
    setBusy(true);
    try {
      const result = await api.decideReviewProposals(queued.map((proposal) => ({
        proposalId: proposal.id, version: proposal.version, decision: decisions[proposal.id],
        proposed: decisions[proposal.id] === 'accept' ? drafts[proposal.id] : undefined,
      })));
      const conflicts = result.outcomes.filter((outcome) => outcome.status === 'conflict' || outcome.status === 'stale').length;
      setMessage(`已處理 ${result.outcomes.length} 項${conflicts ? `，其中 ${conflicts} 項需要重新確認` : ''}。`);
      await localDb.clearCache();
      clearSearchCache();
      await load();
    } finally { setBusy(false); }
  };

  if (!loading && !isAdmin) return <Navigate to="/" replace />;
  return <section className="review-page">
    <header><p className="eyebrow">校稿工作臺</p><h1>匯出、校稿、再確認</h1></header>
    {message && <div className="success-banner" role="status">{message}</div>}
    <div className="review-tools">
      <section className="review-tool-card">
        <div className="list-heading"><h2>匯出校稿檔</h2><span>JSON</span></div>
        <GameSearch value={gameQuery} selectedId={game?.id}
          onChange={(next) => { setGameQuery(next); if (game && next !== game.displayName) setGame(undefined); }}
          onSelect={(selected) => { setGame(selected); setGameQuery(selected.displayName); }} />
        {game && <button className="text-action" type="button" onClick={() => { setGame(undefined); setGameQuery(''); }}>不限遊戲</button>}
        <div className="review-filter-grid">
          <label>Tag<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="例如：補牌" /></label>
          <label>更新日期<input type="date" value={updatedAfter} onChange={(event) => setUpdatedAfter(event.target.value)} /></label>
          <label>最多<select value={limit} onChange={(event) => setLimit(event.target.value)}><option value="50">50 條</option><option value="100">100 條</option><option value="250">250 條</option><option value="500">500 條</option></select></label>
        </div>
        <label className="checkbox"><input type="checkbox" checked={missingSource} onChange={(event) => setMissingSource(event.target.checked)} />只看缺少來源</label>
        <div className="review-export-actions">
          <a className="button primary" href={`${exportUrl}&format=csv`}>下載 CSV</a>
          <a className="button secondary" href={exportUrl}>下載 JSON</a>
        </div>
      </section>
      <section className="review-tool-card">
        <div className="list-heading"><h2>匯入校稿檔</h2>{selectedFile?.changedCount != null && <span>{selectedFile.changedCount} 項提案</span>}</div>
        <label className="review-drop"><input type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} />
          <strong>{selectedFile?.name ?? '選擇 CSV 或 JSON'}</strong>
          {selectedFile?.itemCount != null && <small>共 {selectedFile.itemCount} 條，將匯入 {selectedFile.changedCount} 項修改</small>}
        </label>
        <button type="button" className="button primary full-button" disabled={!selectedFile || busy} onClick={() => void importFile()}>匯入待審核提案</button>
      </section>
    </div>

    <section className="review-queue">
      <div className="review-queue-heading">
        <div><p className="eyebrow">人工審核</p><h2>校稿提案</h2></div>
        <div className="review-queue-filters">
          <select aria-label="提案狀態" value={status} onChange={(event) => setStatus(event.target.value)}><option value="pending">待審核</option><option value="conflict">有衝突</option><option value="accepted">已接受</option><option value="rejected">已拒絕</option></select>
          <select aria-label="校稿批次" value={batchId} onChange={(event) => setBatchId(event.target.value)}><option value="">所有批次</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}（{batch.pendingCount}）</option>)}</select>
        </div>
      </div>
      {proposals.length === 0 && <div className="empty-state">目前沒有符合條件的提案。</div>}
      <div className="review-proposal-list">
        {proposals.map((proposal) => {
          const draft = drafts[proposal.id] ?? proposal.proposed;
          const editable = proposal.status === 'pending' || proposal.status === 'conflict';
          return <article className={`review-proposal ${decisions[proposal.id] ? `decision-${decisions[proposal.id]}` : ''}`} key={proposal.id}>
            <header><div><strong>{proposal.gameName}</strong><small>{proposal.batchName ?? '零散提案'}</small></div>
              {editable && <div className="decision-buttons"><button type="button" className={decisions[proposal.id] === 'accept' ? 'selected' : ''} onClick={() => setDecisions((current) => ({ ...current, [proposal.id]: 'accept' }))}>接受</button><button type="button" className={decisions[proposal.id] === 'reject' ? 'selected reject' : ''} onClick={() => setDecisions((current) => ({ ...current, [proposal.id]: 'reject' }))}>拒絕</button></div>}
            </header>
            {proposal.reason && <p className="review-reason">{proposal.reason}</p>}
            <div className="review-compare">
              <div><span>目前內容</span><p>{proposal.original.statement}</p>{proposal.original.commonMistake && <small>{zhTWCopy.terms.mistakeSituation}：{proposal.original.commonMistake}</small>}</div>
              <div><span>建議內容</span><textarea aria-label="建議規則" rows={3} disabled={!editable} value={draft.statement} onChange={(event) => updateDraft(proposal.id, { statement: event.target.value })} /><textarea aria-label={`建議${zhTWCopy.terms.mistakeSituation}`} rows={2} disabled={!editable} value={value(draft.commonMistake)} onChange={(event) => updateDraft(proposal.id, { commonMistake: event.target.value || null })} placeholder={zhTWCopy.terms.mistakeSituation} /></div>
            </div>
            <details><summary>其他欄位</summary><div className="review-detail-grid">
              <div className="review-wide"><RuleCategoryInput value={draft.categories ?? []}
                disabled={!editable} onChange={(categories) => updateDraft(proposal.id, { categories })} /></div>
              <div className="review-wide"><PlayerCountInput value={draft.playerCounts ?? []}
                disabled={!editable} onChange={(playerCounts) => updateDraft(proposal.id, { playerCounts })} /></div>
              <div className="review-wide"><EditionInput value={draft.editionNotes ?? (draft.editionNote ? [draft.editionNote] : [])}
                options={proposal.original.editionNotes ?? (proposal.original.editionNote ? [proposal.original.editionNote] : [])}
                disabled={!editable} onChange={(editionNotes) => updateDraft(proposal.id, { editionNotes, editionNote: editionNotes[0] ?? null })} /></div>
              <label>Tag<input disabled={!editable} value={draft.tagNames.join('、')} onChange={(event) => updateDraft(proposal.id, { tagNames: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} /></label>
              <label>來源名稱<input disabled={!editable} value={value(draft.sourceLabel)} onChange={(event) => updateDraft(proposal.id, { sourceLabel: event.target.value || null })} /></label>
              <label>資料網址<input disabled={!editable} value={value(draft.sourceUrl)} onChange={(event) => updateDraft(proposal.id, { sourceUrl: event.target.value || null })} /></label>
              <label className="review-wide">補充說明<textarea disabled={!editable} rows={3} value={value(draft.details)} onChange={(event) => updateDraft(proposal.id, { details: event.target.value || null })} /></label>
            </div></details>
          </article>;
        })}
      </div>
      {nextCursor && <button type="button" className="button secondary review-more" disabled={busy} onClick={() => void loadMore()}>載入更多</button>}
      {Object.keys(decisions).length > 0 && <div className="review-submit-bar"><span>{Object.keys(decisions).length} 項尚未送出</span><button type="button" className="button primary" disabled={busy} onClick={() => void submitDecisions()}>送出審核結果</button></div>}
    </section>
  </section>;
};
