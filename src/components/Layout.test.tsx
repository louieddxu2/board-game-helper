import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: { id: 'user-1' }, canEdit: true, isAdmin: false, realIsAdmin: false, mockRole: undefined, logout: vi.fn() }),
}));
vi.mock('../lib/localDb', () => ({ localDb: { getPending: () => Promise.resolve([]) } }));
vi.mock('./SearchModal', () => ({ SearchModal: () => null }));
vi.mock('./ScrollToTop', () => ({ ScrollToTop: () => null }));

describe('Layout navigation', () => {
  afterEach(cleanup);

  test('prefills both desktop and mobile record links with the current game', () => {
    render(<MemoryRouter initialEntries={['/games/seize-the-bean']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/games/:identifier" element={<Outlet />} />
        </Route>
      </Routes>
    </MemoryRouter>);

    const recordLinks = screen.getAllByRole('link', { name: /記錄/ });
    expect(recordLinks).toHaveLength(2);
    expect(recordLinks.every((link) => link.getAttribute('href') === '/add?game=seize-the-bean')).toBe(true);
    expect(document.querySelector('.mobile-primary')).toHaveClass('game-page-primary');
  });
});
