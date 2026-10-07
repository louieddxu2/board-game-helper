import type { Dispatch, RefObject, SetStateAction } from 'react';
import { matchCollectionSubjects, parseGeekGroupCollectionCsv } from '../lib/attributeCollection';
import { localDb } from '../lib/localDb';
import type { AttributeActivity, AttributeCatalogPayload, AttributeExtremeExamples, AttributeQuestion, AttributeQuestionPayload } from '../shared/types';
import type { AttributeVoteScope, ConnectionState } from './attributesPageShared';
import { browserIsOffline } from './attributesPageShared';

interface AttributeCollectionImportOptions {
  setCollectionImporting: Dispatch<SetStateAction<boolean>>;
  setCollectionMessage: Dispatch<SetStateAction<string>>;
  collectionIdsRef: RefObject<number[]>;
  setCollectionIds: Dispatch<SetStateAction<number[]>>;
  setCollectionMatchKnown: Dispatch<SetStateAction<boolean>>;
  loadVotingCatalog: () => Promise<AttributeCatalogPayload>;
  setCollectionMatchCount: Dispatch<SetStateAction<number>>;
  voteScopeRef: RefObject<AttributeVoteScope>;
  requestQuestion: (currentQuestion: AttributeQuestion | undefined, mode?: "pair" | "a" | "b") => Promise<{ question: null; activities: AttributeActivity[]; } | { extremeExamples: AttributeExtremeExamples; question: AttributeQuestion | null; activities: AttributeActivity[]; scoreModelVersion?: string; }>;
  question: AttributeQuestion | undefined;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
  animateQuestionChange: (nextPayload: AttributeQuestionPayload, mode?: "pair" | "a" | "b") => Promise<void>;
  applyQuestionPayload: (nextPayload: AttributeQuestionPayload, scope?: AttributeVoteScope) => void;
  setResponseError: Dispatch<SetStateAction<string>>;
}

export const useAttributeCollectionImport = ({ setCollectionImporting, setCollectionMessage, collectionIdsRef, setCollectionIds, setCollectionMatchKnown, loadVotingCatalog, setCollectionMatchCount, voteScopeRef, requestQuestion, question, setConnectionState, animateQuestionChange, applyQuestionPayload, setResponseError }: AttributeCollectionImportOptions) => {
  const handleCollectionImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCollectionImporting(true);
    setCollectionMessage('');
    try {
      const parsed = parseGeekGroupCollectionCsv(await file.text());
      await localDb.replaceAttributeCollectionIds(parsed.bggIds);
      collectionIdsRef.current = parsed.bggIds;
      setCollectionIds(parsed.bggIds);
      setCollectionMatchKnown(false);
      const catalog = await loadVotingCatalog();
      const match = matchCollectionSubjects(catalog, parsed.bggIds);
      setCollectionMatchCount(match.matchedBggIds.length);
      setCollectionMatchKnown(true);
      setCollectionMessage(`已匯入 ${parsed.bggIds.length} 款，找到 ${match.matchedBggIds.length} 款可投票遊戲。`);
      if (voteScopeRef.current !== 'collection') return;
      const next = await requestQuestion(question, 'pair');
      if (next.question) {
        setConnectionState(browserIsOffline() ? 'offline' : 'online');
        await animateQuestionChange(next, 'pair');
      } else {
        applyQuestionPayload(next);
        setResponseError('這份收藏中目前找不到至少兩款可投票的遊戲。');
      }
    } catch (caught) {
      const message = caught instanceof Error && caught.message === 'csv_game_id_column_missing'
        ? 'CSV 中找不到 Game ID 欄位。'
        : caught instanceof Error && caught.message === 'csv_no_game_ids'
          ? 'CSV 中沒有可辨識的 Game ID。'
        : caught instanceof Error && caught.message === 'csv_file_too_large'
          ? 'CSV 檔案不可超過 5 MB。'
          : 'CSV 匯入失敗，請確認這是 GeekGroup 收藏匯出檔。';
      setCollectionMessage(message);
    } finally {
      setCollectionImporting(false);
    }
  };

  return { handleCollectionImport };
};
