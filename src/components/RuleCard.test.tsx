import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
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

  test('shows only public creator and editor nicknames', () => {
    render(<MemoryRouter><RuleCard
      rule={{
        id: 'rule_credits', gameId: 'game_1', statement: '公開規則', status: 'published',
        createdByNickname: '小明', editedByNicknames: ['小華', '阿德'], tags: [], sourceLinks: [],
      }}
    /></MemoryRouter>);

    expect(screen.getByText('建立：小明')).toBeInTheDocument();
    expect(screen.getByText('修改：小華、阿德')).toBeInTheDocument();
  });
});
