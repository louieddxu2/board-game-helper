import { useEffect, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import type { AttributeQuestion } from '../shared/types';
import { AttributesPageView, AttributesVoteToolbar } from './AttributesPageView';
import { AttributesRankingPage } from './AttributesRankingPage';
import { useAttributesPage } from './useAttributesPage';

type RankingSetup = {
  key: number;
  question: AttributeQuestion;
  scope: 'all' | 'collection';
  collectionIds: number[];
  filter: ReadonlySet<string> | null;
};

export const AttributesPage = () => {
  usePageTitle('桌遊屬性投票');
  const view = useAttributesPage();
  const [rankingOpen, setRankingOpen] = useState(false);
  const [ranking, setRanking] = useState<RankingSetup>();

  const { question, voteScope: scope, collectionIds, attributeFilter: filter } = view;
  const matchesRanking = ranking?.scope === scope && ranking.collectionIds === collectionIds && ranking.filter === filter;
  const changingQuestion = view.scopeLoading || view.questionLoading || view.collectionImporting;

  useEffect(() => {
    if (!rankingOpen || matchesRanking || changingQuestion || !question) return;
    setRanking((current) => ({ key: (current?.key ?? 0) + 1, question, scope, collectionIds, filter }));
  }, [rankingOpen, matchesRanking, changingQuestion, question, scope, collectionIds, filter]);

  const toggleRanking = () => {
    if (rankingOpen) {
      setRankingOpen(false);
      return;
    }
    if (!question) return;
    if (!matchesRanking) setRanking({ key: (ranking?.key ?? 0) + 1, question, scope, collectionIds, filter });
    setRankingOpen(true);
  };

  const noQuestion = !(rankingOpen && matchesRanking) && !view.loading && (view.error || !view.payload || !question);
  return <section className={`attribute-vote-page${rankingOpen ? ' is-ranking' : ''}${noQuestion ? ' attributes-no-question' : ''}`}>
    {!view.loading && <AttributesVoteToolbar view={view} rankingOpen={rankingOpen} onToggleRanking={toggleRanking} />}
    {(!rankingOpen || noQuestion) && <AttributesPageView {...view} />}
    {rankingOpen && !noQuestion && !matchesRanking && <p role="status">載入中…</p>}
    {ranking && matchesRanking && <AttributesRankingPage
      key={ranking.key} initialQuestion={ranking.question} scope={ranking.scope} collectionIds={ranking.collectionIds}
      hidden={!rankingOpen || noQuestion}
      loadVotingCatalog={view.loadVotingCatalog} requestQuestion={view.requestQuestion} queueRanking={view.queueRanking}
      rejectedCount={view.rankingRejectedCount}
      pendingCount={view.pendingCount} syncing={view.syncing} online={view.connectionState !== 'offline'} retrySync={() => void view.syncPendingResponses()}
    />}
  </section>;
};
