import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributesPage } from './AttributesPage';
import { api } from '../lib/api';
import type { AttributeQuestion, AttributesPayload } from '../shared/types';

const subjectA = { id: 'subject-a', slug: 'game-a', kind: 'game' as const, displayName: '遊戲甲', gameSlug: 'game-a' };
const subjectB = { id: 'subject-b', slug: 'game-b', kind: 'game' as const, displayName: '遊戲乙', gameSlug: 'game-b' };
const subjectC = { id: 'subject-c', slug: 'game-c', kind: 'game' as const, displayName: '遊戲丙', gameSlug: 'game-c' };
const subjectD = { id: 'subject-d', slug: 'game-d', kind: 'game' as const, displayName: '遊戲丁', gameSlug: 'game-d' };
const attribute = { id: 'attribute-luck', key: 'luck', name: '運氣成分', fullDescription: '測試說明', minValue: 0, maxValue: 10, sortOrder: 0 };
const payload: AttributesPayload = {
  attributes: [attribute],
  subjects: [subjectA, subjectB],
  values: [],
  candidates: [{ id: 'candidate-1', displayName: '尚未對應遊戲', values: [8], matchStatus: 'pending', sourceRowNumber: 3 }],
  activities: [],
};
const question: AttributeQuestion = { subjectA, subjectB, attribute };
const extremeExamples = {
  lowest: [{ subject: subjectA, score: 0 }, { subject: subjectB, score: 2 }, { subject: subjectC, score: 3 }],
  highest: [{ subject: subjectD, score: 10 }, { subject: subjectA, score: 8 }, { subject: subjectB, score: 7 }],
};

describe('AttributesPage question flow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('starts with a system-selected question without game selectors or the full table', async () => {
    vi.spyOn(api, 'attributes').mockResolvedValue(payload);
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], extremeExamples, questionToken: 'question-token-that-is-long-enough-for-tests' });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '屬性投票' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /哪款遊戲的.*「運氣成分」.*較多？/ })).toBeInTheDocument();
    expect(document.querySelector('.attributes-question-attribute h2 strong')?.textContent).toBe('「運氣成分」');
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
    expect(screen.queryByRole('button', { name: /完整說明/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '屬性總表' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← 左邊較高' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '差不多' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '右邊較高 →' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🎲 換一組' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '換掉遊戲甲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '換掉遊戲乙' })).toBeInTheDocument();
    expect(document.querySelectorAll('.attribute-rating-track')).toHaveLength(1);
    expect(screen.getByRole('slider', { name: '評分：遊戲甲' })).toHaveAttribute('aria-valuenow', '5');
    expect(screen.getByRole('slider', { name: '評分：遊戲乙' })).toHaveAttribute('aria-valuenow', '5');
    expect(screen.getByLabelText('兩款遊戲評分數線')).toBeInTheDocument();
    expect(document.querySelectorAll('.attribute-score-axis')).toHaveLength(2);
    expect(screen.queryByText('封面')).not.toBeInTheDocument();
    expect(screen.queryByText('只送出分數')).not.toBeInTheDocument();
    expect(screen.queryByText('＋ 同時給兩款評分')).not.toBeInTheDocument();
    const leftRating = screen.getByRole('slider', { name: '評分：遊戲甲' });
    fireEvent.keyDown(leftRating, { key: 'ArrowRight' });
    fireEvent.keyDown(leftRating, { key: 'ArrowRight' });
    fireEvent.keyDown(leftRating, { key: 'ArrowRight' });
    expect(screen.getByText('遊戲甲 · 8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消遊戲甲評分' }));
    expect(screen.queryByText('遊戲甲 · 8')).not.toBeInTheDocument();
    expect(api.attributes).not.toHaveBeenCalled();
  });

  test('refreshes only the next question and activity feed after submitting', async () => {
    vi.spyOn(api, 'attributes').mockResolvedValue(payload);
    const questionSpy = vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    vi.spyOn(api, 'saveAttributeResponse').mockResolvedValue({ ok: true, updatedValues: [] });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '← 左邊較高' }));

    await waitFor(() => expect(questionSpy).toHaveBeenCalledTimes(2));
    expect(api.attributes).not.toHaveBeenCalled();
  });

  test('reuses the same response id when a network failure is retried', async () => {
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    const saveSpy = vi.spyOn(api, 'saveAttributeResponse')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ ok: true, updatedValues: [] });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '← 左邊較高' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('無法送出或暫存回答'));
    fireEvent.click(screen.getByRole('button', { name: '← 左邊較高' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy.mock.calls[0][0].responseId).toBe(saveSpy.mock.calls[1][0].responseId);
  });
});
