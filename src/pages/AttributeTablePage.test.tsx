import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributeTablePage } from './AttributeTablePage';
import { api } from '../lib/api';
import type { AttributesPayload } from '../shared/types';

const payload: AttributesPayload = {
  attributes: [{ id: 'attribute-luck', key: 'luck', name: '運氣成分', fullDescription: '測試說明', minValue: 0, maxValue: 10, sortOrder: 0 }],
  subjects: [{ id: 'subject-a', slug: 'game-a', kind: 'game', displayName: '遊戲甲', gameSlug: 'game-a' }],
  values: [{ subjectId: 'subject-a', attributeId: 'attribute-luck', score: 7.25, directAverage: 8, directCount: 1, comparisonCount: 1, decisiveComparisonCount: 1, comparisonScore: 6, modelVersion: 'comparison-blend-v1' }],
  candidates: [{ id: 'candidate-1', displayName: '尚未對應遊戲', values: [8], matchStatus: 'pending', sourceRowNumber: 3 }],
  activities: [],
  scoreModelVersion: 'comparison-blend-v1',
};

describe('AttributeTablePage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('keeps processed scores and pending source rows on the separate read-only page', async () => {
    vi.spyOn(api, 'attributes').mockResolvedValue(payload);

    render(<MemoryRouter><AttributeTablePage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '桌遊屬性總表' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '屬性總表' })).toBeInTheDocument();
    expect(screen.getByText('尚未對應遊戲')).toBeInTheDocument();
    expect(screen.getByTitle(/最終 7.3/)).toBeInTheDocument();
  });
});
