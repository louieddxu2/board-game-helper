import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { SITE_MODE_STORAGE_KEY, UNCERTAIN_RULE_ADD_EVENT, writeSiteMode } from '../lib/siteMode';
import { Layout } from './Layout';

const session = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: { id: 'admin-1' }, canEdit: true, isAdmin: session.isAdmin, realIsAdmin: session.isAdmin, mockRole: undefined, logout: vi.fn() }),
}));
vi.mock('../lib/localDb', () => ({ localDb: { getPending: () => Promise.resolve([]) } }));
vi.mock('./SearchModal', () => ({ SearchModal: () => null }));
vi.mock('./ScrollToTop', () => ({ ScrollToTop: () => null }));

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}>
  <Routes><Route element={<Layout />}><Route path="*" element={<Outlet />} /></Route></Routes>
</MemoryRouter>);

beforeEach(() => { writeSiteMode('wrong'); session.isAdmin = true; });
afterEach(() => { cleanup(); writeSiteMode('wrong'); });

test('an admin switches the whole site between wrong and uncertain rules, remembered on this device', async () => {
  const user = userEvent.setup();
  renderAt('/');
  await user.click(screen.getByRole('button', { name: '切換到不確定的桌遊規則' }));
  expect(screen.getByRole('link', { name: '不確定的桌遊規則首頁' })).toHaveTextContent('?不確定的桌遊規則');
  expect(localStorage.getItem(SITE_MODE_STORAGE_KEY)).toBe('uncertain');
  await user.click(screen.getByRole('button', { name: '切換到玩錯的桌遊規則' }));
  expect(screen.getByRole('link', { name: '玩錯的桌遊規則首頁' })).toBeInTheDocument();
  expect(localStorage.getItem(SITE_MODE_STORAGE_KEY)).toBe('wrong');
});

test('everyone else always sees the wrong-rules site and no switch', () => {
  session.isAdmin = false;
  writeSiteMode('uncertain');
  renderAt('/');
  expect(screen.getByRole('link', { name: '玩錯的桌遊規則首頁' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /切換到/ })).not.toBeInTheDocument();
});

test('in the uncertain mode, 記錄 on a game page notes an uncertain rule instead of opening the add page', async () => {
  const user = userEvent.setup();
  writeSiteMode('uncertain');
  const requested = vi.fn();
  window.addEventListener(UNCERTAIN_RULE_ADD_EVENT, requested);
  renderAt('/games/seize-the-bean');
  const mobileNav = document.querySelector('.mobile-nav') as HTMLElement;
  expect(within(mobileNav).queryByRole('link', { name: /記錄/ })).not.toBeInTheDocument();
  await user.click(within(mobileNav).getByRole('button', { name: /記錄/ }));
  expect(requested).toHaveBeenCalledTimes(1);
  window.removeEventListener(UNCERTAIN_RULE_ADD_EVENT, requested);
  cleanup();
  // Away from a game page there is no game to note it under, so 記錄 keeps its usual page.
  renderAt('/catalog');
  expect(within(document.querySelector('.mobile-nav') as HTMLElement).getByRole('link', { name: /記錄/ })).toHaveAttribute('href', '/add');
});
