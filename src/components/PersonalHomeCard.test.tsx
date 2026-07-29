import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';
import { PersonalHomeCard } from './PersonalHomeCard';

afterEach(cleanup);

describe('PersonalHomeCard', () => {
  test('links to the game and announces unread updates', () => {
    render(<MemoryRouter><PersonalHomeCard game={{
      id: 'g1', slug: 'agricola', displayName: '農家樂', hasUpdates: true,
      latestRule: { id: 'r1', statement: '三人局起始資源不同。', updatedAt: 2 },
    }} /></MemoryRouter>);

    expect(screen.getByRole('link', { name: '農家樂，有新規則' })).toHaveAttribute('href', '/games/agricola');
    expect(screen.getByText('三人局起始資源不同。')).toBeInTheDocument();
    expect(screen.getByText('新')).toBeInTheDocument();
  });

  test('does not announce ordinary recent-update cards as unread', () => {
    render(<MemoryRouter><PersonalHomeCard game={{ id: 'g2', slug: 'splendor', displayName: '璀璨寶石', hasUpdates: false }} /></MemoryRouter>);

    expect(screen.getByRole('link', { name: '璀璨寶石' })).toBeInTheDocument();
    expect(screen.queryByText('新')).not.toBeInTheDocument();
  });
});
