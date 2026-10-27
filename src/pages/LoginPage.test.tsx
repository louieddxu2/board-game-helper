// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoginPage, googleLoginErrorMessage } from './LoginPage';
import { ApiError } from '../lib/api';

const session = vi.hoisted(() => ({ user: null as object | null, loading: false, googleClientId: '', localDevLogin: false, devLogin: vi.fn(), googleLogin: vi.fn() }));
beforeEach(() => { session.user = null; session.googleClientId = ''; session.localDevLogin = false; vi.clearAllMocks(); });
afterEach(() => { cleanup(); delete window.google; document.querySelectorAll('script[data-google-identity]').forEach(script => script.remove()); });

vi.mock('../context/SessionContext', () => ({
  useSession: () => session,
}));

const Destination = () => { const location = useLocation(); return <h1>{location.pathname}{location.search}{location.hash}</h1>; };
const renderLogin = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/login" element={<LoginPage />} /><Route path="*" element={<Destination />} />
</Routes></MemoryRouter>);

describe('LoginPage', () => {
  test('returns a local login to the originating game action', async () => {
    session.localDevLogin = true;
    session.devLogin.mockResolvedValue(undefined);
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/add?game=shipyard#draft' })}`);
    await userEvent.click(screen.getByRole('button', { name: '以本機管理員登入' }));
    expect(await screen.findByRole('heading', { name: '/add?game=shipyard#draft' })).toBeInTheDocument();
    expect(session.devLogin).toHaveBeenCalledOnce();
  });

  test('keeps the return destination after Google rejects a login, then allows retry', async () => {
    session.googleClientId = 'test-client';
    session.googleLogin.mockRejectedValueOnce(new ApiError('invalid_google_identity', 401)).mockResolvedValueOnce(undefined);
    let credentialCallback!: (response: { credential: string }) => void;
    window.google = { accounts: { id: {
      initialize: vi.fn(options => { credentialCallback = options.callback; }), renderButton: vi.fn(), prompt: vi.fn(), disableAutoSelect: vi.fn(),
    } } };
    const script = document.createElement('script'); script.dataset.googleIdentity = 'true'; document.head.append(script);
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/catalog?filter=ship' })}`);
    await act(async () => credentialCallback({ credential: 'rejected-token' }));
    expect(screen.getByRole('alert')).toHaveTextContent('可驗證的信箱身分');
    await act(async () => credentialCallback({ credential: 'retry-token' }));
    expect(await screen.findByRole('heading', { name: '/catalog?filter=ship' })).toBeInTheDocument();
    expect(session.googleLogin.mock.calls).toEqual([['rejected-token'], ['retry-token']]);
  });

  test('continues an originating action when already signed in', async () => {
    session.user = { id: 'signed-in' };
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/add?game=shipyard' })}`);
    expect(await screen.findByRole('heading', { name: '/add?game=shipyard' })).toBeInTheDocument();
  });

  test('links to the privacy notice before Google login', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: '隱私與資料說明' })).toHaveAttribute('href', '/privacy');
  });

  test('lists limited rule creation before voting', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    const benefits = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(benefits).toEqual([
      '查看遊戲列表。',
      '收藏遊戲至個人首頁。',
      '有限度地新增玩錯的規則記錄。',
      '投票玩錯的規則。',
    ]);
  });

  test('keeps server-side Google identity failures distinguishable', () => {
    expect(googleLoginErrorMessage(new ApiError('google_identity_conflict', 500))).toContain('已連結到另一個 Google 身分');
    expect(googleLoginErrorMessage(new ApiError('invalid_google_identity', 500))).toContain('可驗證的信箱身分');
    expect(googleLoginErrorMessage(new ApiError('internal_error', 500))).toContain('登入服務暫時發生錯誤');
  });
});
