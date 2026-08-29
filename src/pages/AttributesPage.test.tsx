import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributesPage } from './AttributesPage';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { AttributeActivity, AttributeCatalogPayload, AttributeQuestion } from '../shared/types';

const subjectA = { id: 'subject-a', slug: 'game-a', kind: 'game' as const, displayName: '遊戲甲', gameSlug: 'game-a' };
const subjectB = { id: 'subject-b', slug: 'game-b', kind: 'game' as const, displayName: '遊戲乙', gameSlug: 'game-b' };
const subjectC = { id: 'subject-c', slug: 'game-c', kind: 'game' as const, displayName: '遊戲丙', gameSlug: 'game-c' };
const subjectD = { id: 'subject-d', slug: 'game-d', kind: 'game' as const, displayName: '遊戲丁', gameSlug: 'game-d' };
const attribute = { id: 'attribute-luck', key: 'luck', name: '運氣成分', fullDescription: '測試說明', minValue: 0, maxValue: 10, sortOrder: 0 };
const question: AttributeQuestion = { subjectA, subjectB, attribute };
const sharedAttributeCatalog: AttributeCatalogPayload = {
  generation: 1,
  throughVersion: 1,
  generatedAt: 1,
  attributes: [attribute],
  subjects: [
    { ...subjectA, bggIds: [123] },
    { ...subjectB, bggIds: [456] },
  ],
  values: [],
  candidates: [],
  activities: [],
  scoreModelVersion: 'glicko-rd-v1',
};
const extremeExamples = {
  lowest: [{ subject: subjectA, score: 0 }, { subject: subjectB, score: 2 }, { subject: subjectC, score: 3 }],
  highest: [{ subject: subjectD, score: 10 }, { subject: subjectA, score: 8 }, { subject: subjectB, score: 7 }],
};
const recentActivities: AttributeActivity[] = [
  { id: 'rating-a', kind: 'rating', actorName: '玩家', attributeId: attribute.id, attributeName: attribute.name, subject: subjectA, value: 8, createdAt: 1 },
  { id: 'comparison', kind: 'comparison', actorName: '玩家', attributeId: attribute.id, attributeName: attribute.name, subjectA, subjectB, ratingA: 8, ratingB: 3, result: 'A_HIGHER', createdAt: 1 },
  ...Array.from({ length: 4 }, (_, index) => ({ id: `comparison-${index}`, kind: 'comparison' as const, actorName: '玩家', attributeId: attribute.id, attributeName: attribute.name, subjectA, subjectB, result: 'SIMILAR' as const, createdAt: index + 2 })),
];

describe('AttributesPage question flow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('starts with a system-selected question without game selectors or the full table', async () => {
    const tableSpy = vi.spyOn(api, 'attributeTable');
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: recentActivities, extremeExamples, questionToken: 'question-token-that-is-long-enough-for-tests' });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '屬性投票' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '屬性總表' })).toHaveAttribute('href', '/attributes/table');
    expect(screen.getByRole('heading', { name: /哪款遊戲的.*「運氣成分」.*較多？/ })).toBeInTheDocument();
    const voteHeader = screen.getByRole('heading', { name: '屬性投票' }).closest('header');
    const recentActivity = screen.getByLabelText('最近投票記錄');
    expect(voteHeader).not.toContainElement(recentActivity);
    expect((voteHeader?.compareDocumentPosition(recentActivity) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(recentActivity.querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByLabelText('最近投票記錄').querySelector('li > span:last-child')).toHaveTextContent(/玩家\s*認為\s*遊戲甲（8）\s*的「運氣成分」比\s*遊戲乙（3）\s*更多/);
    expect(screen.getByLabelText('最近投票記錄')).not.toHaveTextContent('給');
    expect(document.querySelector('.attributes-question-attribute h2 strong')?.textContent).toBe('「運氣成分」');
    expect(screen.getByText('↑ 範例')).toBeInTheDocument();
    expect(document.querySelectorAll('.attributes-scoreline-marker')).toHaveLength(4);
    expect(screen.getByTitle('0 分：遊戲甲')).toBeInTheDocument();
    expect(screen.getByTitle('10 分：遊戲丁')).toBeInTheDocument();
    expect(screen.queryByTitle('3 分：遊戲丙')).not.toBeInTheDocument();
    expect(screen.queryByTitle('7 分：遊戲乙')).not.toBeInTheDocument();
    expect(document.querySelector('.attributes-scoreline-marker.is-low.is-lower')).toHaveTextContent('遊戲甲');
    expect(document.querySelector('.attributes-scoreline-marker.is-low.is-upper')).toHaveTextContent('遊戲乙');
    expect(document.querySelector('.attributes-scoreline-marker.is-high.is-lower')).toHaveTextContent('遊戲丁');
    expect(document.querySelector('.attributes-scoreline-marker.is-high.is-upper')).toHaveTextContent('遊戲甲');
    expect(screen.getByLabelText('目前資料中的極端分數範例')).toBeInTheDocument();
    expect(screen.getByLabelText('目前資料中的極端分數範例').compareDocumentPosition(screen.getByRole('heading', { name: /哪款遊戲的/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: /哪款遊戲的/ }).closest('.attributes-question-center')).toBeInTheDocument();
    expect(screen.getByLabelText('兩款遊戲評分數線').closest('.attributes-rating-zone')).toBeInTheDocument();
    expect((document.querySelector('.attributes-pair-actions')?.compareDocumentPosition(screen.getByLabelText('兩款遊戲評分數線')) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /完整說明/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '屬性總表' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '遊戲甲較高' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '差不多' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '遊戲乙較高' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '不知道，換一組' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '換掉遊戲甲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '換掉遊戲乙' })).toBeInTheDocument();
    expect(screen.queryByText('VS')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '← 左邊較高' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.attribute-rating-track')).toHaveLength(1);
    expect(screen.getByRole('slider', { name: '評分：遊戲甲' })).toHaveAttribute('aria-valuenow', '5');
    expect(screen.getByRole('slider', { name: '評分：遊戲乙' })).toHaveAttribute('aria-valuenow', '5');
    expect(screen.getByLabelText('兩款遊戲評分數線')).toBeInTheDocument();
    expect(document.querySelectorAll('.attribute-score-axis')).toHaveLength(2);
    expect(screen.queryByText('封面')).not.toBeInTheDocument();
    expect(screen.queryByText('只送出分數')).not.toBeInTheDocument();
    expect(screen.queryByText('＋ 同時給兩款評分')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '投票範圍' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部遊戲' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '我的收藏' })).toBeDisabled();
    expect(tableSpy).not.toHaveBeenCalled();
    const leftRating = screen.getByRole('slider', { name: '評分：遊戲甲' });
    fireEvent.keyDown(leftRating, { key: 'ArrowRight' });
    fireEvent.keyDown(leftRating, { key: 'ArrowRight' });
    fireEvent.keyDown(leftRating, { key: 'ArrowRight' });
    expect(screen.getByText('遊戲甲 · 8')).toBeInTheDocument();
    const rightRating = screen.getByRole('slider', { name: '評分：遊戲乙' });
    fireEvent.keyDown(rightRating, { key: 'ArrowRight' });
    expect(screen.getByText('依照分數，建議點「遊戲甲」')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '遊戲甲較高' })).toHaveClass('is-suggested');
    fireEvent.keyDown(rightRating, { key: 'ArrowRight' });
    fireEvent.keyDown(rightRating, { key: 'ArrowRight' });
    expect(screen.getByText('依照分數，建議選「差不多」')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '差不多' })).toHaveClass('is-suggested');
    fireEvent.click(screen.getByRole('button', { name: '取消遊戲甲評分' }));
    expect(screen.queryByText('遊戲甲 · 8')).not.toBeInTheDocument();
    expect(screen.queryByText(/依照分數，建議/)).not.toBeInTheDocument();
  });

  test('renders a fresh cached question without waiting for another opening request', async () => {
    vi.spyOn(localDb, 'getPendingAttributeResponses').mockResolvedValue([]);
    vi.spyOn(localDb, 'getAttributeVoteScope').mockResolvedValue('all');
    vi.spyOn(localDb, 'getAttributeCollectionIds').mockResolvedValue([]);
    vi.spyOn(localDb, 'getLatestAttributeQuestion').mockResolvedValue({
      key: 'attributes:question:v1',
      data: { question, activities: recentActivities, extremeExamples, questionToken: 'cached-question-token-that-is-long-enough' },
      scope: 'all',
      cachedAt: Date.now(),
    });
    vi.spyOn(localDb, 'cacheAttributeQuestion').mockResolvedValue('attributes:question:v1');
    const questionSpy = vi.spyOn(api, 'attributeQuestion');

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: /哪款遊戲的.*「運氣成分」.*較多？/ })).toBeInTheDocument();
    expect(screen.queryByText('載入中…')).not.toBeInTheDocument();
    expect(screen.queryByText('目前離線，回答會先暫存在本機。')).not.toBeInTheDocument();
    expect(questionSpy).not.toHaveBeenCalled();
  });

  test('switches to an imported collection through the shared attribute catalog cache', async () => {
    vi.spyOn(localDb, 'getPendingAttributeResponses').mockResolvedValue([]);
    vi.spyOn(localDb, 'getAttributeVoteScope').mockResolvedValue('all');
    vi.spyOn(localDb, 'getAttributeCollectionIds').mockResolvedValue([123, 456]);
    vi.spyOn(localDb, 'getLatestAttributeQuestion').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'setAttributeVoteScope').mockResolvedValue('attributes:vote-scope:v1');
    const tableSpy = vi.spyOn(api, 'attributeTable').mockResolvedValue(sharedAttributeCatalog);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const questionSpy = vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '我的收藏 (2)' }));
    await waitFor(() => expect(tableSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(questionSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '全部遊戲' })).not.toBeDisabled());
    expect(questionSpy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      fixedSubjectAId: subjectA.id,
      fixedSubjectBId: subjectB.id,
      fixedAttributeId: attribute.id,
    }));
  });

  test('refreshes only the next question and activity feed after submitting', async () => {
    const questionSpy = vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    vi.spyOn(api, 'saveAttributeResponse').mockResolvedValue({ ok: true, updatedValues: [] });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.keyDown(await screen.findByRole('slider', { name: '評分：遊戲甲' }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: '遊戲甲較高' }));

    expect(screen.getByRole('button', { name: '遊戲甲較高' })).toHaveClass('is-selected');
    expect(await screen.findByText('已記錄：遊戲甲較高')).toBeInTheDocument();
    await waitFor(() => expect(questionSpy).toHaveBeenCalledTimes(2));
    expect(api.saveAttributeResponse).toHaveBeenCalledWith(expect.objectContaining({ comparison: 'A_HIGHER', ratingA: 6 }));
  });

  test('reuses the same response id when a network failure is retried', async () => {
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    const saveSpy = vi.spyOn(api, 'saveAttributeResponse')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ ok: true, updatedValues: [] });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '遊戲甲較高' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('無法送出或暫存回答'));
    fireEvent.click(screen.getByRole('button', { name: '遊戲甲較高' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy.mock.calls[0][0].responseId).toBe(saveSpy.mock.calls[1][0].responseId);
  });

  test('treats similar as an answer and unknown as a write-free skip', async () => {
    const questionSpy = vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    const saveSpy = vi.spyOn(api, 'saveAttributeResponse').mockResolvedValue({ ok: true, updatedValues: [] });

    const { unmount } = render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '差不多' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ comparison: 'SIMILAR' })));
    await waitFor(() => expect(questionSpy).toHaveBeenCalledTimes(2));
    unmount();
    vi.clearAllMocks();

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '不知道，換一組' }));

    await waitFor(() => expect(questionSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
