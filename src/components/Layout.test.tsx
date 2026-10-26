import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  test.each([
    ['/', '/add'],
    ['/games/seize-the-bean', '/add?game=seize-the-bean'],
    ['/account', '/add'],
  ])('keeps the mobile navigation focused on actions at %s', (path, recordHref) => {
    render(<MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<Outlet />} />
        </Route>
      </Routes>
    </MemoryRouter>);

    const mobileNav = document.querySelector('.mobile-nav');
    expect(mobileNav).toBeInTheDocument();
    expect(within(mobileNav as HTMLElement).getByRole('button', { name: /搜尋/ })).toBeInTheDocument();
    expect(within(mobileNav as HTMLElement).getByRole('link', { name: /記錄/ })).toHaveAttribute('href', recordHref);
    expect(within(mobileNav as HTMLElement).getByRole('link', { name: /帳號/ })).toBeInTheDocument();
    expect(within(mobileNav as HTMLElement).queryByRole('link', { name: /首頁|探索/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '玩錯的桌遊規則首頁' })).toBeInTheDocument();
  });

  test('returns to the home route when the top-left brand is clicked', async () => {
    const user = userEvent.setup();

    render(<MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<h1>首頁內容</h1>} />
          <Route path="/account" element={<div>帳號內容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>);

    await user.click(screen.getByRole('link', { name: '玩錯的桌遊規則首頁' }));

    expect(await screen.findByRole('heading', { name: '首頁內容' })).toBeInTheDocument();
  });

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
