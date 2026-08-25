import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributeTablePage } from './AttributeTablePage';
import { api } from '../lib/api';
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
    expect(screen.getByRole('heading', { name: '屬性總表', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('尚未對應遊戲')).toBeInTheDocument();
    expect(screen.getByTitle(/目前 7.3/)).toBeInTheDocument();
  });
});
