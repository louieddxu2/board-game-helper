import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../lib/api';
import type { TagSummary } from '../shared/types';
import { getCommonTagSuggestions, TagInput } from './TagInput';

const tag = (id: string, name: string): TagSummary => ({ id, slug: id, name });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(api, 'tags').mockResolvedValue({
    tags: [tag('public-scoring', '計分'), { ...tag('public-setup', '設置'), aliases: ['準備'] }],
  });
});

describe('TagInput recommendations', () => {
  test('ranks frequently used game tags without another data request', () => {
    const turn = tag('turn', '回合流程');
    const scoring = tag('scoring', '計分');
    const setup = tag('setup', '設置');

    expect(getCommonTagSuggestions([scoring, turn, setup, turn, scoring, turn], [])).toEqual([turn, scoring, setup]);
  });

  test('shows inferred and common tags below the field and adds them on click', () => {
    const onChange = vi.fn();
    const scoring = tag('scoring', '計分');
    const setup = tag('setup', '設置');
    render(<TagInput value={[]} onChange={onChange} availableTags={[scoring, setup, scoring]} detectedSuggestions={['設置']} />);

    expect(screen.getByText('根據規則內容')).toBeInTheDocument();
    expect(screen.getByText('這款遊戲常用')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '加入標籤 設置' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '加入標籤 計分' }));
    expect(onChange).toHaveBeenCalledWith(['計分']);
  });

  test('keeps duplicate game usage for ranking but deduplicates the search menu', async () => {
    const scoring = tag('scoring', '計分');
    const view = render(<TagInput value={[]} onChange={vi.fn()} availableTags={[scoring, scoring, scoring]} />);

    fireEvent.focus(view.getByRole('combobox'));

    expect(await view.findAllByRole('option', { name: '#計分' })).toHaveLength(1);
  });

  test('includes unseen public tags in game search and text inference', async () => {
    const view = render(<TagInput value={[]} onChange={vi.fn()} availableTags={[tag('game-turn', '回合')]} detectionInput={{ statement: '準備時抽五張牌' }} />);

    expect(await view.findByRole('button', { name: '加入標籤 設置' })).toBeInTheDocument();

    fireEvent.focus(view.getByRole('combobox'));
    expect(await view.findByRole('option', { name: '#計分' })).toBeInTheDocument();
    expect(view.getByRole('option', { name: '#回合' })).toBeInTheDocument();
  });
});
