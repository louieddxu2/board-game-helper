import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { SITE_MODE_STORAGE_KEY, writeSiteMode } from '../lib/siteMode';
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

test('記錄 keeps its link in both modes; the add page itself follows the mode', () => {
  writeSiteMode('uncertain');
  renderAt('/games/seize-the-bean');
  expect(within(document.querySelector('.mobile-nav') as HTMLElement).getByRole('link', { name: /記錄/ })).toHaveAttribute('href', '/add?game=seize-the-bean');
});
