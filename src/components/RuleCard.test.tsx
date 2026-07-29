import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { RuleCard } from './RuleCard';

describe('RuleCard', () => {
  test('keeps the game link and source link as separate valid anchors', () => {
    const { container } = render(<MemoryRouter><RuleCard
      gameName="船廠"
      gameHref="/games/shipyard"
      rule={{
        id: 'rule_1', gameId: 'game_1', statement: '三人局使用五個方塊',
        flowStage: 'setup', sourceUrl: 'https://example.com/rules', status: 'published',
        tags: [], sourceLinks: [{ url: 'https://example.com/rules' }],
      }}
    /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '船廠' })).toHaveAttribute('href', '/games/shipyard');
    expect(screen.getByRole('link', { name: /查看依據/ })).toHaveAttribute('href', 'https://example.com/rules');
    expect(container.querySelector('a a')).toBeNull();
  });

  test('places tags and public credits before the edit button in one header row', () => {
    const { container } = render(<MemoryRouter><RuleCard
      onEdit={vi.fn()}
      rule={{
        id: 'rule_credits', gameId: 'game_1', statement: '公開規則', status: 'published',
        createdByNickname: '小明', editedByNicknames: ['小華', '阿德'],
        tags: [{ id: 'tag_1', slug: 'setup', name: '設置' }], sourceLinks: [],
      }}
    /></MemoryRouter>);

    expect(screen.getByText('建立：小明')).toBeInTheDocument();
    expect(screen.getByText('修改：小華、阿德')).toBeInTheDocument();
    const header = container.querySelector('.rule-card-header');
    expect(header?.querySelector('.rule-tags')).toContainElement(screen.getByText('#設置'));
    expect(Array.from(header?.children ?? []).map((element) => element.className)).toEqual([
      'rule-card-title-group', 'rule-credits', 'text-action edit-btn',
    ]);
  });

  test('does not show a game title or zero when a single-game card has no public credits', () => {
    const { container } = render(<MemoryRouter><RuleCard
      gameName="不應重複顯示的遊戲"
      rule={{
        id: 'rule_plain', gameId: 'game_1', statement: '一般規則', status: 'published',
        editedByNicknames: [], tags: [], sourceLinks: [],
      }}
    /></MemoryRouter>);

    expect(screen.queryByText('不應重複顯示的遊戲')).not.toBeInTheDocument();
    expect(container.querySelector('.rule-credits')).toBeNull();
    expect(container).not.toHaveTextContent('0');
  });

  test('shows an unresolved tag ID as non-interactive 未知標籤', () => {
    const onTagClick = vi.fn();
    render(<MemoryRouter><RuleCard
      onTagClick={onTagClick}
      rule={{
        id: 'rule_unknown_tag', gameId: 'game_1', statement: '一般規則', status: 'published',
        tagIds: ['tag_missing'],
        tags: [{ id: 'tag_missing', slug: 'tag_missing', name: '未知標籤', unresolved: true }],
        sourceLinks: [],
      }}
    /></MemoryRouter>);

    expect(screen.getByText('#未知標籤')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '#未知標籤' })).not.toBeInTheDocument();
    expect(onTagClick).not.toHaveBeenCalled();
  });

  test('exposes a reversible importance vote with its aggregate count', () => {
    const onToggleImportance = vi.fn();
    render(<MemoryRouter><RuleCard
      importanceVoted
      onToggleImportance={onToggleImportance}
      rule={{
        id: 'rule_vote', gameId: 'game_1', statement: '容易玩錯', status: 'published',
        importanceCount: 3, tags: [], sourceLinks: [],
      }}
    /></MemoryRouter>);

    const button = screen.getByRole('button', { name: /我也玩錯過/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('3 票')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onToggleImportance).toHaveBeenCalledOnce();
  });

  test('shows a non-interactive aggregate to signed-out readers only when votes exist', () => {
    const { rerender } = render(<MemoryRouter><RuleCard rule={{
      id: 'rule_vote', gameId: 'game_1', statement: '容易玩錯', status: 'published',
      importanceCount: 2, tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.getByText('重要 · 2')).toBeInTheDocument();
    rerender(<MemoryRouter><RuleCard rule={{
      id: 'rule_zero', gameId: 'game_1', statement: '一般規則', status: 'published',
      importanceCount: 0, tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.queryByText(/重要 ·/)).not.toBeInTheDocument();
  });
});
