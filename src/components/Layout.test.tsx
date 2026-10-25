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

  test('does not expose the local Workspace from the site navigation', () => {
    render(<MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Outlet />} />
        </Route>
      </Routes>
    </MemoryRouter>);

    expect(screen.queryByRole('link', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  test('keeps attribute voting reachable by direct URL instead of the main navigation', () => {
    render(<MemoryRouter initialEntries={['/'] }>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Outlet />} />
        </Route>
      </Routes>
    </MemoryRouter>);

    expect(screen.queryByRole('link', { name: '屬性' })).not.toBeInTheDocument();
  });

  test('renders the attribute app without the main-site header, navigation, or footer', () => {
    render(<MemoryRouter initialEntries={['/attributes']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/attributes" element={<Outlet />} />
        </Route>
      </Routes>
    </MemoryRouter>);

    expect(document.querySelector('.attribute-app-shell')).toBeInTheDocument();
    expect(document.querySelector('.site-header')).not.toBeInTheDocument();
    expect(document.querySelector('.mobile-nav')).not.toBeInTheDocument();
    expect(document.querySelector('footer')).not.toBeInTheDocument();
  });

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
