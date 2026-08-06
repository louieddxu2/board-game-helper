import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { CompactRuleCard, RuleCard } from './RuleCard';
import type { RuleCard as RuleCardType } from '../shared/types';

describe('RuleCard', () => {
  test('makes player-count and edition attributes clickable when filter handlers are provided', () => {
    const onPlayerCountsClick = vi.fn();
    const onEditionClick = vi.fn();
    render(<MemoryRouter><RuleCard
      onPlayerCountsClick={onPlayerCountsClick}
      onEditionClick={onEditionClick}
      rule={{
        id: 'rule_filters', gameId: 'game_1', statement: 'rule', status: 'published',
        playerCounts: [2, 3, 4], editionNotes: ['Base Expansion'], tags: [], sourceLinks: [],
      }}
    /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /2~4/ }));
    fireEvent.click(screen.getByRole('button', { name: /Base Expansion/ }));
    expect(onPlayerCountsClick).toHaveBeenCalledWith([2, 3, 4]);
    expect(onEditionClick).toHaveBeenCalledWith('Base Expansion');
  });

  test('shows a pending contribution as unreviewed', () => {
    render(<MemoryRouter><RuleCard rule={{
      id: 'rule_pending', gameId: 'game_1', statement: '待審核規則', status: 'published',
      reviewStatus: 'pending', tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.getByText('未審核')).toBeInTheDocument();
  });

  test('shows the public reviewer name after review', () => {
    render(<MemoryRouter><RuleCard rule={{
      id: 'rule_reviewed', gameId: 'game_1', statement: '已審核規則', status: 'published',
      reviewStatus: 'reviewed', reviewedByNickname: '東東', tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.getByText('審核：東東')).toBeInTheDocument();
  });

  test('does not render a review row for editor-created content', () => {
    const { container } = render(<MemoryRouter><RuleCard rule={{
      id: 'rule_trusted', gameId: 'game_1', statement: '正式規則', status: 'published',
      reviewStatus: 'not_required', tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(container.querySelector('.rule-credits')).toBeNull();
    expect(container).not.toHaveTextContent('未審核');
    expect(container).not.toHaveTextContent(/審核/);
  });

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

  test('never shows cached game context when rendering a single-game card', () => {
    const cachedRule = {
      id: 'rule_cached_game_context', gameId: 'game_1', statement: '單款遊戲規則', status: 'published',
      gameName: '快取中的遊戲名稱', gameSlug: 'cached-game', tags: [], sourceLinks: [],
    } as RuleCardType & { gameName: string; gameSlug: string };
    const { container } = render(<MemoryRouter><RuleCard
      showGameContext={false}
      rule={cachedRule}
    /></MemoryRouter>);

    expect(screen.queryByText('快取中的遊戲名稱')).not.toBeInTheDocument();
    expect(container.querySelector('.rule-game-title')).toBeNull();
    expect(container.querySelector('.rule-card.clickable')).toBeNull();
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

  test('renders long statements and supplementary details without truncation controls', () => {
    const statement = '這是一段超過八十字的完整正確規則，必須保留所有條件、例外與後續步驟，不能在中間被省略，讓玩家可以直接依照原文完整查閱。';
    const details = '這是一段超過八十字的完整補充說明，包含背景、特殊情境與來源脈絡，標準卡片應該一次完整顯示。';
    const { container } = render(<MemoryRouter><RuleCard rule={{
      id: 'rule_long_text', gameId: 'game_1', statement, details,
      status: 'published', tags: [], sourceLinks: [],
    }} /></MemoryRouter>);

    expect(container.querySelector('.statement-text')).toHaveTextContent(statement);
    expect(container.querySelector('.details-text')).toHaveTextContent(details);
    expect(container.querySelectorAll('.details-toggle')).toHaveLength(0);
    expect(container).not.toHaveTextContent('...');
  });

  test('supports compact rule expansion and keeps filter attributes interactive', () => {
    const onToggleExpanded = vi.fn();
    const onTagClick = vi.fn();
    const onPlayerCountsClick = vi.fn();
    const onEditionClick = vi.fn();
    const { container } = render(<MemoryRouter><CompactRuleCard
      onToggleExpanded={onToggleExpanded}
      onTagClick={onTagClick}
      onPlayerCountsClick={onPlayerCountsClick}
      onEditionClick={onEditionClick}
      rule={{
        id: 'rule_compact', gameId: 'game_1', statement: '完整正確敘述', commonMistake: '完整玩錯情況',
        details: '有補充說明', playerCounts: [2, 3], editionNotes: ['擴充甲'], status: 'published',
        tags: [{ id: 'tag-1', slug: 'setup', name: '設置' }], sourceLinks: [],
      }}
    /></MemoryRouter>);

    const compact = container.querySelector('.rule-card-compact') as HTMLElement;
    expect(compact).not.toHaveAttribute('role');
    expect(within(compact).getByRole('button', { name: '展開規則' })).toHaveAttribute('aria-expanded', 'false');
    expect(compact).toHaveTextContent('完整正確敘述');
    expect(compact).toHaveTextContent('完整玩錯情況');
    expect(compact).toHaveTextContent('#設置');
    expect(compact).not.toHaveTextContent('💬 補充說明');
    expect(compact).not.toHaveTextContent('展開');
    expect(compact.querySelector('.compact-rule-mistake')).toBeInTheDocument();
    fireEvent.click(within(compact).getByText('完整正確敘述'));
    expect(onToggleExpanded).toHaveBeenCalledOnce();
    fireEvent.click(within(compact).getByText('完整玩錯情況'));
    fireEvent.click(compact);
    expect(onToggleExpanded).toHaveBeenCalledOnce();
    fireEvent.click(within(compact).getByRole('button', { name: /2~3/ }));
    fireEvent.click(within(compact).getByRole('button', { name: /擴充甲/ }));
    fireEvent.click(within(compact).getByRole('button', { name: '#設置' }));
    expect(onTagClick).toHaveBeenCalledWith('設置');
    expect(onPlayerCountsClick).toHaveBeenCalledWith([2, 3]);
    expect(onEditionClick).toHaveBeenCalledWith('擴充甲');
  });

  test('only toggles an expanded card from its statement paragraph or explicit control', () => {
    const onToggleExpanded = vi.fn();
    const { container } = render(<MemoryRouter><RuleCard
      onToggleExpanded={onToggleExpanded}
      rule={{
        id: 'rule_toggle_boundary', gameId: 'game_1', statement: '可收合的正文',
        commonMistake: '不可收合的玩錯情況', details: '不可收合的補充說明',
        status: 'published', tags: [], sourceLinks: [],
      }}
    /></MemoryRouter>);

    const card = container.querySelector('.rule-card') as HTMLElement;
    fireEvent.click(within(card).getByText('不可收合的玩錯情況'));
    fireEvent.click(within(card).getByText('不可收合的補充說明'));
    fireEvent.click(card);
    expect(onToggleExpanded).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByText('可收合的正文'));
    fireEvent.click(within(card).getByRole('button', { name: '收合規則' }));
    expect(onToggleExpanded).toHaveBeenCalledTimes(2);
  });

  test('exposes expansion as a real button without nesting other controls inside it', () => {
    const onToggleExpanded = vi.fn();
    const { container } = render(<MemoryRouter><CompactRuleCard
      onToggleExpanded={onToggleExpanded}
      onTagClick={vi.fn()}
      rule={{
        id: 'rule_accessible', gameId: 'game_1', statement: '點擊內文展開', status: 'published',
        tags: [{ id: 'tag-1', slug: 'setup', name: '設置' }], sourceLinks: [],
      }}
    /></MemoryRouter>);

    const toggle = within(container).getByRole('button', { name: '展開規則' });
    fireEvent.click(toggle);

    expect(onToggleExpanded).toHaveBeenCalledOnce();
    expect(toggle.querySelector('button, a')).toBeNull();
    expect(container.querySelector('.rule-card-compact')?.querySelectorAll('button')).toHaveLength(2);
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

    const button = screen.getByRole('button', { name: '取消「我也玩錯過」，目前 3' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('重要！')).toBeInTheDocument();
    expect(screen.getByText('✓ 我也玩錯過')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onToggleImportance).toHaveBeenCalledOnce();
  });

  test('shows a non-interactive aggregate to signed-out readers only when votes exist', () => {
    const { rerender } = render(<MemoryRouter><RuleCard rule={{
      id: 'rule_vote', gameId: 'game_1', statement: '容易玩錯', status: 'published',
      importanceCount: 2, tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.getByLabelText('標記數量 2')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    rerender(<MemoryRouter><RuleCard rule={{
      id: 'rule_zero', gameId: 'game_1', statement: '一般規則', status: 'published',
      importanceCount: 0, tags: [], sourceLinks: [],
    }} /></MemoryRouter>);
    expect(screen.queryByLabelText(/標記數量/)).not.toBeInTheDocument();
  });
});
