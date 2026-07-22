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
        isFeatured: false, createdAt: 1, updatedAt: 1,
      }}
    /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '三人局使用五個方塊' })).toHaveAttribute('href', '/games/shipyard');
    expect(screen.getByRole('link', { name: /查看依據/ })).toHaveAttribute('href', 'https://example.com/rules');
    expect(container.querySelector('a a')).toBeNull();
  });
});
