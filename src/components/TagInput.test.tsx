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
  test('does not use public tag aliases for manual tag search', async () => {
    const draw = { ...tag('public-draw', 'Draw'), aliases: ['Refill'] };
    const view = render(<TagInput value={[]} onChange={vi.fn()} availableTags={[draw]}
      detectionInput={{ statement: 'Refill the market before drawing.' }} />);

    expect(await view.findByRole('button', { name: /Draw/ })).toBeInTheDocument();

    const input = view.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Refill' } });

    await vi.waitFor(() => {
      expect(view.queryByRole('option', { name: '#Draw' })).not.toBeInTheDocument();
    });
  });

  test('reopens tag suggestions when the user taps the focused input after dismissing the keyboard', async () => {
    const view = render(<TagInput value={[]} onChange={vi.fn()} availableTags={[tag('public-scoring', '閮?')]} />);
    const input = view.getByRole('combobox');

    fireEvent.focus(input);
    await view.findByRole('option', { name: '#閮?' });

    fireEvent.pointerDown(document.body);
    expect(view.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.pointerDown(input);
    await vi.waitFor(() => expect(view.getByRole('listbox')).toBeVisible());
  });

  test('repositions tag suggestions when the mobile visual viewport changes', async () => {
    const visualViewport = new EventTarget();
    const previousVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });

    try {
      const view = render(<TagInput value={[]} onChange={vi.fn()} availableTags={[tag('public-scoring', '閮?')]} />);
      const input = view.getByRole('combobox');
      let bottom = 34;
      vi.spyOn(input, 'getBoundingClientRect').mockImplementation(() => ({
        top: 10, left: 10, right: 210, bottom, width: 200, height: 24, x: 10, y: 10,
        toJSON: () => ({}),
      }) as DOMRect);

      fireEvent.focus(input);
      const listbox = await view.findByRole('listbox');
      expect(listbox).toHaveStyle({ top: '39px' });

      bottom = 54;
      visualViewport.dispatchEvent(new Event('resize'));
      await vi.waitFor(() => expect(listbox).toHaveStyle({ top: '59px' }));
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    }
  });

  test('commits a composed mobile tag on Enter instead of advancing focus', () => {
    const onChange = vi.fn();
    const parentKeyDown = vi.fn();
    const view = render(<div onKeyDown={parentKeyDown}><TagInput value={[]} onChange={onChange} /></div>);
    const input = view.getByRole('combobox');

    fireEvent.change(input, { target: { value: '計分' } });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    input.dispatchEvent(enter);
    fireEvent.compositionEnd(input, { data: '計分' });

    expect(enter.defaultPrevented).toBe(true);
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith([{ name: '計分' }]);
  });

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

    expect(screen.getByText('根據正確規則')).toBeInTheDocument();
    expect(screen.getByText('這款遊戲常用')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '加入標籤 設置' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '加入標籤 計分' }));
    expect(onChange).toHaveBeenCalledWith([{ id: 'scoring', name: '計分' }]);
  });

  test('preserves a known tag ID and keeps only genuinely new text as a name', async () => {
    const onKnownChange = vi.fn();
    const knownView = render(<TagInput value={[]} onChange={onKnownChange} availableTags={[tag('known-score', '計分')]} />);
    fireEvent.click(knownView.getByRole('button', { name: '加入標籤 計分' }));
    expect(onKnownChange).toHaveBeenCalledWith([{ id: 'known-score', name: '計分' }]);
    knownView.unmount();

    const onNewChange = vi.fn();
    const newView = render(<TagInput value={[]} onChange={onNewChange} availableTags={[]} />);
    const input = newView.getByRole('combobox');
    fireEvent.change(input, { target: { value: '新標籤' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNewChange).toHaveBeenCalledWith([{ name: '新標籤' }]);
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

  test('shows public tag buttons even when text inference finds no match', async () => {
    const view = render(<TagInput value={[]} onChange={vi.fn()} availableTags={[]} detectionInput={{ statement: '沒有對應標籤的內容' }} />);

    expect(await view.findByText('公共標籤')).toBeInTheDocument();
    expect(view.getByRole('button', { name: '加入標籤 計分' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: '加入標籤 設置' })).toBeInTheDocument();
  });
});
