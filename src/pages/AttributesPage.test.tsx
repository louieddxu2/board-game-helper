import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AttributesPage } from './AttributesPage';
import { api } from '../lib/api';
import type { AttributeQuestion, AttributesPayload } from '../shared/types';

const subjectA = { id: 'subject-a', slug: 'game-a', kind: 'game' as const, displayName: '遊戲甲', gameSlug: 'game-a' };
const subjectB = { id: 'subject-b', slug: 'game-b', kind: 'game' as const, displayName: '遊戲乙', gameSlug: 'game-b' };
const attribute = { id: 'attribute-luck', key: 'luck', name: '運氣成分', fullDescription: '測試說明', minValue: 0, maxValue: 10, sortOrder: 0 };
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

  test('starts with a system-selected question and exposes pending source rows without game selectors', async () => {
    vi.spyOn(api, 'attributes').mockResolvedValue(payload);
    vi.spyOn(api, 'attributeQuestion').mockResolvedValue({ question });

    render(<MemoryRouter><AttributesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '桌遊屬性比較' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '運氣成分' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('尚未對應遊戲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '送出回答，換下一題' })).toBeInTheDocument();
  });
});
