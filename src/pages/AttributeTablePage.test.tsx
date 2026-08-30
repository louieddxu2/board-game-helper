import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributeTablePage } from './AttributeTablePage';
import { api } from '../lib/api';
import { ToastProvider } from '../context/ToastContext';
import type { AttributeCatalogPayload } from '../shared/types';

const payload: AttributeCatalogPayload = {
  attributes: [{ id: 'attribute-luck', key: 'luck', name: '運氣成分', fullDescription: '測試說明', minValue: 0, maxValue: 10, sortOrder: 0 }],
  subjects: [{ id: 'subject-a', slug: 'game-a', kind: 'game', displayName: '遊戲甲', gameSlug: 'game-a' }],
  values: [{ subjectId: 'subject-a', attributeId: 'attribute-luck', score: 7.25, ratingDeviation: 1.2, directAverage: 8, directCount: 1, comparisonCount: 1, decisiveComparisonCount: 1, evidenceCount: 2, modelVersion: 'glicko-rd-v1' }],
  candidates: [{ id: 'candidate-1', displayName: '尚未對應遊戲', values: [8], matchStatus: 'pending', sourceRowNumber: 3 }],
  activities: [],
  scoreModelVersion: 'glicko-rd-v1',
  generation: 1,
  throughVersion: 1,
  generatedAt: Date.now(),
};

describe('AttributeTablePage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('keeps processed scores and pending source rows on the separate read-only page', async () => {
    vi.spyOn(api, 'attributeTable').mockResolvedValue(payload);

    render(<MemoryRouter><AttributeTablePage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '屬性總表', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回投票' })).toHaveAttribute('href', '/attributes');
    expect(screen.queryByRole('heading', { name: '屬性總表', level: 2 })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByText('尚未對應遊戲')).toBeInTheDocument();
    expect(screen.getByTitle(/目前 7.3/)).toBeInTheDocument();
  });

  test('cycles an attribute column from descending to ascending and back to normal', async () => {
    const sortablePayload: AttributeCatalogPayload = {
      ...payload,
      subjects: [
        ...payload.subjects,
        { id: 'subject-b', slug: 'game-b', kind: 'game', displayName: '遊戲乙' },
      ],
      values: [
        ...payload.values,
        { subjectId: 'subject-b', attributeId: 'attribute-luck', score: 9.5, ratingDeviation: 1, directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'glicko-rd-v1' },
      ],
    };
    vi.spyOn(api, 'attributeTable').mockResolvedValue(sortablePayload);

    render(<MemoryRouter><AttributeTablePage /></MemoryRouter>);

    const rows = () => [...document.querySelectorAll('.attributes-matrix tbody tr')].map((row) => row.querySelector('th')?.textContent?.trim());
    const normal = await screen.findByRole('button', { name: '運氣成分排序：正常' });
    expect(rows()).toEqual(['遊戲甲已對應遊戲', '遊戲乙已對應遊戲', '尚未對應遊戲待對應遊戲']);

    fireEvent.click(normal);
    expect(rows()).toEqual(['遊戲乙已對應遊戲', '尚未對應遊戲待對應遊戲', '遊戲甲已對應遊戲']);
    fireEvent.click(screen.getByRole('button', { name: '運氣成分排序：由大到小' }));
    expect(rows()).toEqual(['遊戲甲已對應遊戲', '尚未對應遊戲待對應遊戲', '遊戲乙已對應遊戲']);
    fireEvent.click(screen.getByRole('button', { name: '運氣成分排序：由小到大' }));
    expect(rows()).toEqual(['遊戲甲已對應遊戲', '遊戲乙已對應遊戲', '尚未對應遊戲待對應遊戲']);
  });

  test('clears text search and ranks comparable games when a game is selected', async () => {
    const similarityPayload: AttributeCatalogPayload = {
      ...payload,
      subjects: [
        ...payload.subjects,
        { id: 'subject-b', slug: 'game-b', kind: 'game', displayName: '遊戲乙' },
        { id: 'subject-c', slug: 'game-c', kind: 'game', displayName: '遊戲丙' },
      ],
      values: [
        ...payload.values,
        { subjectId: 'subject-b', attributeId: 'attribute-luck', score: 7.5, ratingDeviation: 1, directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'glicko-rd-v1' },
        { subjectId: 'subject-c', attributeId: 'attribute-luck', score: 1, ratingDeviation: 1, directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'glicko-rd-v1' },
      ],
    };
    vi.spyOn(api, 'attributeTable').mockResolvedValue(similarityPayload);

    render(<MemoryRouter><AttributeTablePage /></MemoryRouter>);
    const search = await screen.findByRole('searchbox');
    fireEvent.change(search, { target: { value: '遊戲甲' } });
    fireEvent.click(screen.getByRole('button', { name: '遊戲甲' }));

    expect(search).toHaveValue('');
    const rows = [...document.querySelectorAll('.attributes-matrix tbody tr')].map((row) => row.querySelector('th')?.textContent?.trim());
    expect(rows).toEqual(['遊戲甲相近比較基準', '遊戲乙共同資料 1 項', '遊戲丙共同資料 1 項']);
  });

  test('rejects similarity mode with a toast when no real overlapping data exists', async () => {
    const noDataPayload: AttributeCatalogPayload = {
      ...payload,
      values: [{ ...payload.values[0], score: 5, ratingDeviation: 3, directCount: 0, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 0 }],
    };
    vi.spyOn(api, 'attributeTable').mockResolvedValue(noDataPayload);

    render(<MemoryRouter><ToastProvider><AttributeTablePage /></ToastProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '遊戲甲' }));

    expect(screen.getByRole('status')).toHaveTextContent('尚無可評斷相近的資料');
    expect(screen.getByText('尚未對應遊戲')).toBeInTheDocument();
  });
});
