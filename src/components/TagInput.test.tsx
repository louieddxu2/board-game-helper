import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TagSummary } from '../shared/types';
import { getCommonTagSuggestions, TagInput } from './TagInput';

const tag = (id: string, name: string): TagSummary => ({ id, slug: id, name });

afterEach(cleanup);

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
});
