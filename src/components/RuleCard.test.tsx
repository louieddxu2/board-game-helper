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

  test('renders supplementary details as a separate subdued section', () => {
    const { container } = render(<MemoryRouter><RuleCard rule={{
      id: 'rule_details', gameId: 'game_1', statement: '先執行主要行動',
      commonMistake: '誤以為可以略過', details: '只有第一位玩家需要執行',
      status: 'published', tags: [], sourceLinks: [],
    }} /></MemoryRouter>);

    const statement = container.querySelector('.statement-text');
    const mistake = container.querySelector('.mistake');
    const details = container.querySelector('.rule-details-note');
    expect(statement).toHaveTextContent('先執行主要行動');
    expect(statement).not.toHaveTextContent('只有第一位玩家需要執行');
    expect(mistake).toHaveTextContent('玩錯情況');
    expect(details).toHaveTextContent('補充說明');
    expect(details).toHaveTextContent('只有第一位玩家需要執行');
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

    const button = screen.getByRole('button', { name: '取消公開投票，目前 3 票' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAccessibleName('取消公開投票，目前 3 票');
    expect(screen.getByText('公開投票')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onToggleImportance).toHaveBeenCalledOnce();
  });

  test('shows a non-interactive aggregate to signed-out readers only when votes exist', () => {
    const { rerender } = render(<MemoryRouter><RuleCard rule={{
      id: 'rule_vote', gameId: 'game_1', statement: '容易玩錯', status: 'published',
      importanceCount: 2, tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.getByText('公開票數')).toBeInTheDocument();
    expect(screen.getByText('2 票')).toBeInTheDocument();
    rerender(<MemoryRouter><RuleCard rule={{
      id: 'rule_zero', gameId: 'game_1', statement: '一般規則', status: 'published',
      importanceCount: 0, tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.queryByText('公開票數')).not.toBeInTheDocument();
  });
});
