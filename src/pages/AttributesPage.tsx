import { useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import type { AttributeQuestion } from '../shared/types';
import { AttributesPageView } from './AttributesPageView';
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

  const openRanking = () => {
    const { question, voteScope: scope, collectionIds, attributeFilter: filter } = view;
    if (!question) return;
    if (!ranking || ranking.scope !== scope || ranking.collectionIds !== collectionIds || ranking.filter !== filter) {
      setRanking({ key: (ranking?.key ?? 0) + 1, question, scope, collectionIds, filter });
    }
    setRankingOpen(true);
  };

  return <>
    {!rankingOpen && <AttributesPageView {...view} onOpenRanking={openRanking} />}
    {ranking && <AttributesRankingPage
      key={ranking.key} initialQuestion={ranking.question} scope={ranking.scope} collectionIds={ranking.collectionIds}
      hidden={!rankingOpen} onExit={() => setRankingOpen(false)}
      loadVotingCatalog={view.loadVotingCatalog} requestQuestion={view.requestQuestion} queueRanking={view.queueRanking}
      rejectedCount={view.rankingRejectedCount}
      pendingCount={view.pendingCount} syncing={view.syncing} online={view.connectionState !== 'offline'} retrySync={() => void view.syncPendingResponses()}
    />}
  </>;
};
