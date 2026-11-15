import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { attributeQuestionEnding, attributeQuestionStart } from '../lib/attributeQuestion';
import { attributeDisplayEndpoints } from '../shared/attributeScale';
import type { AttributeQuestion, AttributeSubject } from '../shared/types';
import { canPlaceRankedSubject, loadRankingRound, rankedPlayerOrder } from './attributeRanking';
import type { AttributesPageViewModel } from './useAttributesPage';
import { useAttributeRankingInput } from './useAttributeRankingInput';

const CANDIDATES_PER_PAGE = 18;
type RankingRound = Awaited<ReturnType<typeof loadRankingRound>>;

interface RankingProps {
  initialQuestion: AttributeQuestion;
  scope: AttributesPageViewModel['voteScope'];
  collectionIds: number[];
  hidden: boolean;
  onExit: () => void;
  loadVotingCatalog: AttributesPageViewModel['loadVotingCatalog'];
  requestQuestion: AttributesPageViewModel['requestQuestion'];
  queueRanking: AttributesPageViewModel['queueRanking'];
  pendingCount: number;
  rejectedCount: number;
  syncing: boolean;
  online: boolean;
  retrySync: () => void;
}

export const AttributesRankingPage = ({ initialQuestion, scope, collectionIds, hidden, onExit, loadVotingCatalog, requestQuestion, queueRanking, pendingCount, rejectedCount, syncing, online, retrySync }: RankingProps) => {
  const [question, setQuestion] = useState(initialQuestion);
  const [round, setRound] = useState<RankingRound>();
  const [limit, setLimit] = useState(CANDIDATES_PER_PAGE);
  const [ordered, setOrdered] = useState<AttributeSubject[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const [loadingError, setLoadingError] = useState(false);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  const references = useMemo(() => new Map(round?.references.map((example) => [example.subject.id, example])), [round]);
  const referenceIds = useMemo(() => new Set(references.keys()), [references]);
  const order = useMemo(() => ordered.map(({ id }) => id), [ordered]);
  const playerRanks = useMemo(() => new Map(rankedPlayerOrder(order, referenceIds).map((id, index) => [id, index + 1])), [order, referenceIds]);
  const comparisonCount = Math.max(0, playerRanks.size - 1);

  useEffect(() => {
    let active = true;
    void loadVotingCatalog()
      .then((catalog) => loadRankingRound(catalog, question, scope === 'collection' ? collectionIds : undefined))
      .then((next) => {
        if (!active) return;
        setRound(next);
        setOrdered(next.references.map(({ subject }) => subject));
      })
      .catch(() => { if (active) setLoadingError(true); });
    return () => { active = false; };
  }, [collectionIds, loadVotingCatalog, loadingAttempt, question, scope]);

  const place = (id: string, index: number) => {
    const subject = references.get(id)?.subject ?? round?.candidates.find((item) => item.id === id);
    if (!subject || busy || submitted) return;
    if (!canPlaceRankedSubject(order, referenceIds, id, index)) {
      setMessage('參考遊戲須維持分數順序。');
      return;
    }
    setOrdered((current) => {
      const previousIndex = current.findIndex((item) => item.id === id);
      const next = current.filter((item) => item.id !== id);
      next.splice(index - Number(previousIndex >= 0 && previousIndex < index), 0, subject);
      return next;
    });
    setSelected(undefined);
    setMessage('');
  };

  const { drag, ghostRef, input } = useAttributeRankingInput(listRef, place);
  const endpoints = attributeDisplayEndpoints(question.attribute, question.highPole);
  const highLabel = endpoints?.high.label ?? question.attribute.name;
  const description = endpoints
    ? endpoints.high.shortDescription ?? endpoints.high.fullDescription
    : question.attribute.shortDescription ?? question.attribute.fullDescription;
  const remaining = useMemo(() => {
    const chosen = new Set(ordered.map((subject) => subject.id));
    return round?.candidates.filter((subject) => !chosen.has(subject.id)) ?? [];
  }, [round, ordered]);
  const nameFor = (id?: string) => id !== undefined
    ? references.get(id)?.subject.displayName ?? round?.candidates.find((subject) => subject.id === id)?.displayName
    : undefined;
  const selectedName = nameFor(selected);
  const ghostName = nameFor(drag?.id);
  const locked = busy || submitted;

  const onSubmit = async () => {
    if (inProgress.current || submitted || comparisonCount === 0) return;
    inProgress.current = true;
    setSelected(undefined);
    setBusy(true);
    setMessage('');
    try {
      await queueRanking(question, order, referenceIds);
      setSubmitted(true);
    } catch {
      setMessage('無法儲存排序，請再試一次。');
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  };

  const onNext = async () => {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    setMessage('');
    try {
      const next = (await requestQuestion(question)).question;
      if (!next) {
        setMessage('目前沒有下一題。');
        return;
      }
      setOrdered([]);
      setRound(undefined);
      setLimit(CANDIDATES_PER_PAGE);
      setLoadingError(false);
      setSubmitted(false);
      setQuestion(next);
      poolRef.current?.scrollTo(0, 0);
      listRef.current?.scrollTo(0, 0);
    } catch {
      setMessage('無法取得下一題，請再試一次。');
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  };

  const renderSlot = (index: number) => {
    const before = ordered[index - 1]?.displayName;
    const after = ordered[index]?.displayName;
    const label = before && after ? `插在${before}與${after}之間`
      : after ? `放在${after}前面` : before ? `放在${before}後面` : '放進比較欄';
    const activeDrop = drag?.index === index;
    const blockedDrop = activeDrop && !canPlaceRankedSubject(order, referenceIds, drag.id, index);
    return selected && !locked && canPlaceRankedSubject(order, referenceIds, selected, index)
      ? <button type="button" className="attribute-rank-insert" onClick={() => place(selected, index)} aria-label={label}><span aria-hidden="true">＋</span> 插在這裡</button>
      : <div className="attribute-rank-slot" data-rank-slot={index} data-over={activeDrop && !blockedDrop || undefined} data-blocked={blockedDrop || undefined} aria-hidden="true" />;
  };

  return <section className="attribute-ranking-page" hidden={hidden} {...input} aria-labelledby="attribute-ranking-question">
    <header className="attribute-rank-topbar">
      <span>屬性投票</span>
      <button type="button" className="attribute-ranking-toggle" onClick={onExit} disabled={busy}>切回兩兩比較</button>
    </header>
    <div className="attribute-rank-description">
      <h1 id="attribute-ranking-question">{attributeQuestionStart(question.attribute.key)}<strong>「{highLabel}」</strong>{attributeQuestionEnding(question.attribute.key)}？</h1>
      {description && <p>{description}</p>}
    </div>
    <div className="attribute-rank-board">
      <section className="attribute-rank-pool" aria-label="候選遊戲">
        <h2>候選遊戲</h2>
        <div className="attribute-rank-list" ref={poolRef}>
          {!round && !loadingError && <p className="attribute-rank-empty" role="status">載入遊戲中…</p>}
          {loadingError && <button type="button" className="attribute-rank-more" onClick={() => { setLoadingError(false); setLoadingAttempt((attempt) => attempt + 1); }}>重新載入遊戲</button>}
          {round && !remaining.length && <p className="attribute-rank-empty">{round.candidates.length ? '已排入全部候選遊戲。' : '這個範圍目前沒有候選遊戲。'}</p>}
          {remaining.slice(0, limit).map((subject) => <button type="button" key={subject.id} className="attribute-rank-game" data-rank-game={subject.id} data-rank-source="pool" data-dragged={drag?.id === subject.id || undefined} aria-pressed={selected === subject.id} disabled={locked} onClick={() => setSelected((current) => current === subject.id ? undefined : subject.id)}>
            {subject.thumbnailUrl && <img src={subject.thumbnailUrl} alt="" loading="lazy" draggable={false} onError={(event) => { event.currentTarget.hidden = true; }} />}
            <span>{subject.displayName}</span>
          </button>)}
          {remaining.length > limit && <button type="button" className="attribute-rank-more" disabled={locked} onClick={() => setLimit((current) => current + CANDIDATES_PER_PAGE)}>更多遊戲</button>}
        </div>
      </section>
      <section className="attribute-rank-order" aria-label="比較欄">
        <h2>比較欄 <span>↑ {endpoints?.high.label ?? '程度較高'}</span></h2>
        <div className="attribute-rank-list" ref={listRef} data-rank-list>
          {ordered.map((subject, index) => {
            const reference = references.get(subject.id);
            const referenceLabel = reference ? `參考 ${Number(reference.score.toFixed(2))} 分` : undefined;
            const playerRank = playerRanks.get(subject.id);
            const label = referenceLabel ? `${subject.displayName}，${referenceLabel}` : `第 ${playerRank} 名，${subject.displayName}`;
            return <Fragment key={subject.id}>
              {renderSlot(index)}
              <div className="attribute-rank-row" data-rank-row>
                <button type="button" className="attribute-rank-game" data-rank-game={subject.id} data-rank-reference={reference?.score} data-dragged={drag?.id === subject.id || undefined} aria-pressed={selected === subject.id} aria-label={label} disabled={locked} onClick={() => setSelected((current) => current === subject.id ? undefined : subject.id)}>
                  <span className="attribute-rank-grip" data-rank-grip aria-hidden="true">⠿ {playerRank !== undefined && <b>{playerRank}</b>}</span>
                  <span>{subject.displayName}{referenceLabel && <small className="attribute-rank-reference-score">{referenceLabel}</small>}</span>
                </button>
                {!submitted && !reference && <button type="button" className="attribute-rank-remove" disabled={busy} aria-label={`將${subject.displayName}移回候選區`} onClick={() => { setOrdered((current) => current.filter((item) => item.id !== subject.id)); setSelected(undefined); }}>×</button>}
              </div>
            </Fragment>;
          })}
          {renderSlot(ordered.length)}
          {!ordered.length && !selected && <p className="attribute-rank-empty">從左邊拖入遊戲</p>}
        </div>
        <p className="attribute-rank-low">↓ {endpoints?.low.label ?? '程度較低'}</p>
      </section>
    </div>
    <div className="attribute-rank-footer">
      <div className="attribute-rank-footer-copy">
        {message && <p role="alert">{message}</p>}
        {rejectedCount > 0 && <p role="alert">有 {rejectedCount} 組比較已失效，未能同步。</p>}
        <p role="status">{selectedName ? `已選取${selectedName}，請點插入位置。`
          : submitted ? `已儲存 ${comparisonCount} 組相鄰比較`
            : comparisonCount ? `將送出 ${comparisonCount} 組自選遊戲比較` : '請排入至少 2 款玩過的遊戲'}</p>
        {pendingCount > 0 && <div className="attribute-rank-sync">
          <span>{pendingCount} 筆待同步</span>
          {online && !syncing && <button type="button" onClick={retrySync}>重新同步</button>}
        </div>}
      </div>
      {submitted
        ? <button type="button" className="attribute-rank-submit" disabled={busy} onClick={() => void onNext()}>{busy ? '載入中…' : '下一題'}</button>
        : <button type="button" className="attribute-rank-submit" disabled={locked || comparisonCount === 0} onClick={() => void onSubmit()}>{busy ? '儲存中…' : '送出排序'}</button>}
    </div>
    <div ref={ghostRef} className="attribute-rank-ghost" hidden={!ghostName} aria-hidden="true">{ghostName}</div>
  </section>;
};
