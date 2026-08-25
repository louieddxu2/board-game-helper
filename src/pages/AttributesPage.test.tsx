import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributesPage } from './AttributesPage';
import { api } from '../lib/api';
import type { AttributeQuestion, AttributesPayload } from '../shared/types';

const subjectA = { id: 'subject-a', slug: 'game-a', kind: 'game' as const, displayName: '遊戲甲', gameSlug: 'game-a' };
const subjectB = { id: 'subject-b', slug: 'game-b', kind: 'game' as const, displayName: '遊戲乙', gameSlug: 'game-b' };
const attribute = { id: 'attribute-luck', key: 'luck', name: '運氣成分', fullDescription: '測試說明', minExample: '聖托里尼', maxExample: '分數沙拉', minValue: 0, maxValue: 10, sortOrder: 0 };
const payload: AttributesPayload = {
  attributes: [attribute],
  subjects: [subjectA, subjectB],
  values: [],
  candidates: [{ id: 'candidate-1', displayName: '尚未對應遊戲', values: [8], matchStatus: 'pending', sourceRowNumber: 3 }],
  activities: [],
};
const question: AttributeQuestion = { subjectA, subjectB, attribute };

describe('AttributesPage question flow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('starts with a system-selected question without game selectors or the full table', async () => {
    vi.spyOn(api, 'attributes').mockResolvedValue(payload);
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '桌遊屬性比較' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '運氣成分' })).toBeInTheDocument();
    expect(screen.getByText('0 分：聖托里尼')).toBeInTheDocument();
    expect(screen.getByText('10 分：分數沙拉')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '屬性總表' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '送出回答，換下一題' })).toBeInTheDocument();
    expect(api.attributes).not.toHaveBeenCalled();
  });

  test('refreshes only the next question and activity feed after submitting', async () => {
    vi.spyOn(api, 'attributes').mockResolvedValue(payload);
    const questionSpy = vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    vi.spyOn(api, 'saveAttributeResponse').mockResolvedValue({ ok: true, updatedValues: [] });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '遊戲甲 較高' }));
    fireEvent.click(screen.getByRole('button', { name: '送出回答，換下一題' }));

    await waitFor(() => expect(questionSpy).toHaveBeenCalledTimes(2));
    expect(api.attributes).not.toHaveBeenCalled();
  });

  test('reuses the same response id when a network failure is retried', async () => {
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question, activities: [], questionToken: 'question-token-that-is-long-enough-for-tests' });
    const saveSpy = vi.spyOn(api, 'saveAttributeResponse')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ ok: true, updatedValues: [] });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '遊戲甲 較高' }));
    const submit = screen.getByRole('button', { name: '送出回答，換下一題' });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('無法送出或暫存回答'));
    fireEvent.click(submit);

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(saveSpy.mock.calls[0][0].responseId).toBe(saveSpy.mock.calls[1][0].responseId);
  });
});
