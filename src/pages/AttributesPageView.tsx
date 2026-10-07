import { Link } from 'react-router-dom';
import { AttributeGameCard } from '../components/AttributeGameCard';
import { AttributeRatingTrack } from '../components/AttributeRatingTrack';
import { AttributeScoreAxis } from '../components/AttributeScoreAxis';
import { attributeQuestionEnding } from '../lib/attributeQuestion';
import { suggestedComparisonForRatings } from '../lib/attributeRatingSuggestion';
import { attributeDisplayEndpoints, orientAttributeScore } from '../shared/attributeScale';
import { activityText, attributeQuestionKey, ExtremeScoreMarker, mergeRecentActivities } from './attributesPageShared';
import type { AttributesPageViewModel } from './useAttributesPage';

export const AttributesPageView = ({
  collectionImporting,
  collectionInputRef,
  handleCollectionImport,
  collectionIds,
  collectionMatchKnown,
  collectionMatchCount,
  voteScope,
  changeVoteScope,
  scopeLoading,
  loading,
  error,
  payload,
  question,
  collectionMessage,
  optimisticActivities,
  comparisonQuestionKey,
  ratingA,
  ratingB,
  connectionState,
  pendingCount,
  syncPendingResponses,
  loadQuestion,
  syncing,
  questionLoading,
  questionMotion,
  submitting,
  comparison,
  chooseComparison,
  awaitingNext,
  voteFeedback,
  deferCurrentAndLoad,
  setRatingA,
  setRatingB,
  responseError,
}: AttributesPageViewModel) => {
const collectionImportControl = <label className="attributes-collection-import">
    <span>{collectionImporting ? '讀取中…' : '匯入收藏'}</span>
    <input ref={collectionInputRef} type="file" accept=".csv,text/csv" onChange={(event) => void handleCollectionImport(event)} disabled={collectionImporting} />
  </label>;

const collectionScopeLabel = !collectionIds.length
    ? '我的收藏'
    : collectionMatchKnown ? `我的收藏 ${collectionMatchCount}/${collectionIds.length}` : `我的收藏 (${collectionIds.length})`;

const voteScopeControl = <div className="attributes-vote-scope" role="group" aria-label="投票範圍">
    <span className="attributes-vote-scope-label">投票範圍</span>
    <button type="button" className={voteScope === 'all' ? 'is-active' : undefined} aria-pressed={voteScope === 'all'} onClick={() => void changeVoteScope('all')} disabled={scopeLoading || voteScope === 'all'}>全部遊戲</button>
    <button type="button" className={voteScope === 'collection' ? 'is-active' : undefined} aria-pressed={voteScope === 'collection'} onClick={() => void changeVoteScope('collection')} disabled={scopeLoading || voteScope === 'collection' || !collectionIds.length} title={collectionIds.length ? '只從匯入收藏中有屬性資料的遊戲出題' : '請先匯入收藏 CSV'}>{scopeLoading ? '切換中…' : collectionScopeLabel}</button>
  </div>;

if (loading) return <section className="attribute-vote-page"><p>載入中…</p></section>;

if (error || !payload || !question) return <section className="attribute-vote-page attributes-no-question">
    <header className="attribute-vote-header"><h1>屬性投票</h1><div className="attributes-vote-actions">{collectionImportControl}<Link className="attributes-table-link" to="/attributes/table">屬性總表</Link></div></header>
    {voteScopeControl}
    <p>{voteScope === 'collection' && collectionIds.length ? `我的收藏中只有 ${collectionMatchCount} 款遊戲可用，至少需要兩款。` : '目前無法取得題目。'}</p>
    {collectionMessage && <p className="attributes-collection-message" role="status">{collectionMessage}</p>}
    <button type="button" className="button primary" onClick={() => window.location.reload()}>重新載入</button>
  </section>;

const endpoints = attributeDisplayEndpoints(question.attribute, question.highPole);

const displayedExamples = [...(payload.extremeExamples?.lowest ?? []), ...(payload.extremeExamples?.highest ?? [])]
    .map((example) => ({ ...example, score: orientAttributeScore(example.score, question.highPole) }));

const lowestExamples = [...displayedExamples]
    .filter((example) => example.score <= 2)
    .sort((left, right) => left.score - right.score)
    .slice(0, 2);

const highestExamples = [...displayedExamples]
    .filter((example) => example.score >= 8)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);

const attributeDescription = endpoints
    ? endpoints.high.shortDescription ?? endpoints.high.fullDescription
    : question.attribute.shortDescription ?? question.attribute.fullDescription;

const questionLabel = endpoints?.high.label ?? question.attribute.name;

const questionEnding = attributeQuestionEnding(question.attribute.key);

const recentComparisons = mergeRecentActivities(payload.activities, optimisticActivities);

const comparisonSelectedForCurrentQuestion = comparisonQuestionKey === attributeQuestionKey(question);

const ratingSuggestion = suggestedComparisonForRatings(ratingA, ratingB);

const ratingSuggestionText = ratingSuggestion === 'A_HIGHER'
    ? `依照分數，建議點「${question.subjectA.displayName}」`
    : ratingSuggestion === 'B_HIGHER'
      ? `依照分數，建議點「${question.subjectB.displayName}」`
      : ratingSuggestion === 'SIMILAR' ? '依照分數，建議選「差不多」' : '';

return <section className="attribute-vote-page">
    <header className="attribute-vote-header">
      <h1>屬性投票</h1>
      <div className="attributes-vote-actions">
        {collectionImportControl}
        <Link className="attributes-table-link" to="/attributes/table">屬性總表</Link>
      </div>
    </header>
    {voteScopeControl}
    {collectionMessage && <p className="attributes-collection-message" role="status">{collectionMessage}</p>}
    <div className="attributes-inline-activity" aria-label="最近投票記錄">
      {recentComparisons.length ? <ol>{recentComparisons.map((activity) => <li key={activity.id}><span className="attributes-inline-activity-icon" aria-hidden="true">比</span><span>{activityText(activity)}</span></li>)}</ol> : <span className="attributes-inline-activity-empty">尚無近期紀錄</span>}
    </div>

    {(connectionState !== 'online' || pendingCount > 0) && <p className="attributes-offline-note" role="status">
      {pendingCount > 0
        ? `有 ${pendingCount} 筆回答等待同步。`
        : connectionState === 'offline'
          ? '目前離線，回答會先暫存在本機。'
          : '目前暫時無法連線到伺服器，回答會先暫存在本機。'}
      <button
        type="button"
        onClick={() => pendingCount > 0 ? void syncPendingResponses() : void loadQuestion('pair')}
        disabled={syncing || questionLoading}
      >
        {syncing ? '同步中…' : pendingCount > 0 ? '重新同步' : '重試連線'}
      </button>
    </p>}

    <section className={`attributes-question-card is-${questionMotion}`} aria-labelledby="attributes-question-heading" aria-busy={questionLoading || submitting}>
      <div className="attributes-question-center">
        {(lowestExamples.length || highestExamples.length) ? <div className="attributes-question-examples">
          {endpoints && <div className="attribute-pole-labels"><span>0 · {endpoints.low.label}</span><strong>10 · {endpoints.high.label}</strong></div>}
          <AttributeScoreAxis ariaLabel="目前資料中的極端分數範例" className="attributes-scoreline-track">
            {lowestExamples.map((example, index) => <ExtremeScoreMarker example={example} direction="low" row={index === 0 ? 'lower' : 'upper'} key={`low:${example.subject.id}`} />)}
            {highestExamples.map((example, index) => <ExtremeScoreMarker example={example} direction="high" row={index === 0 ? 'lower' : 'upper'} key={`high:${example.subject.id}`} />)}
          </AttributeScoreAxis>
        </div> : null}
        <div className="attributes-question-attribute">
          <h2 id="attributes-question-heading" aria-live="polite">哪款遊戲的<span className="attributes-question-term"><strong>「{questionLabel}」</strong>{(lowestExamples.length || highestExamples.length) ? <span className="attributes-example-cue" aria-hidden="true">↑ 範例</span> : null}</span>{questionEnding}？</h2>
          {attributeDescription && <p className="attributes-question-description">{attributeDescription}</p>}
        </div>
        <div className="attributes-question-pair">
          <div className="attributes-question-side">
            <AttributeGameCard highLabel={endpoints?.high.label} key={question.subjectA.id} subject={question.subjectA} side="left" selected={comparisonSelectedForCurrentQuestion && comparison === 'A_HIGHER'} suggested={!submitting && ratingSuggestion === 'A_HIGHER'} onChoose={() => chooseComparison('A_HIGHER')} disabled={questionLoading || submitting || awaitingNext} />
          </div>
          <div className="attributes-question-side">
            <AttributeGameCard highLabel={endpoints?.high.label} key={question.subjectB.id} subject={question.subjectB} side="right" selected={comparisonSelectedForCurrentQuestion && comparison === 'B_HIGHER'} suggested={!submitting && ratingSuggestion === 'B_HIGHER'} onChoose={() => chooseComparison('B_HIGHER')} disabled={questionLoading || submitting || awaitingNext} />
          </div>
          {voteFeedback && <p className={`attributes-vote-feedback is-${voteFeedback.state}`} role="status" aria-live="polite"><span aria-hidden="true">{voteFeedback.state === 'saved' ? '✓' : '…'}</span>{voteFeedback.text}</p>}
        </div>

        <div className="attributes-pair-actions" aria-label="回答與換題">
          <button type="button" className="attributes-change-one is-left" aria-label={`換掉${question.subjectA.displayName}`} onClick={() => void deferCurrentAndLoad('a')} disabled={questionLoading || submitting || awaitingNext}><span aria-hidden="true">↻</span> 換一個</button>
          <button type="button" className={`attributes-similar ${comparisonSelectedForCurrentQuestion && comparison === 'SIMILAR' ? 'is-selected' : ''} ${!submitting && ratingSuggestion === 'SIMILAR' ? 'is-suggested' : ''}`} aria-pressed={comparisonSelectedForCurrentQuestion && comparison === 'SIMILAR'} onClick={() => chooseComparison('SIMILAR')} disabled={questionLoading || submitting || awaitingNext}><span aria-hidden="true">≈</span> 差不多</button>
          <button type="button" className="attributes-change-one is-right" aria-label={`換掉${question.subjectB.displayName}`} onClick={() => void deferCurrentAndLoad('b')} disabled={questionLoading || submitting || awaitingNext}>換一個 <span aria-hidden="true">↻</span></button>
          <button type="button" className="attributes-unknown" aria-label="不知道，換一組" onClick={() => void deferCurrentAndLoad('pair')} disabled={questionLoading || submitting || awaitingNext}>不知道</button>
        </div>
        <div className="attributes-rating-zone">
          <AttributeRatingTrack lowLabel={endpoints?.low.label} highLabel={endpoints?.high.label} leftSubject={question.subjectA} rightSubject={question.subjectB} leftValue={ratingA} rightValue={ratingB} onLeftChange={setRatingA} onRightChange={setRatingB} onLeftClear={() => setRatingA('')} onRightClear={() => setRatingB('')} disabled={questionLoading || submitting || awaitingNext} />
          {ratingSuggestionText && !submitting && <p className="attributes-rating-suggestion" role="status"><span aria-hidden="true">↑</span> {ratingSuggestionText}</p>}
          {responseError && <p className="attributes-response-error" role="alert">{responseError} {awaitingNext && <button type="button" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>重新取得下一題</button>}</p>}
        </div>
      </div>
    </section>

  </section>;
};
