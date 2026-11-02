// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoginPage, googleLoginErrorMessage, googleNameFromCredential } from './LoginPage';
import { ApiError, api } from '../lib/api';
import { localDb } from '../lib/localDb';

const session = vi.hoisted(() => ({ user: null as { id: string; nickname?: string; showNickname?: boolean } | null, loading: false, googleClientId: '', localDevLogin: false, devLogin: vi.fn(), googleLogin: vi.fn(), refresh: vi.fn() }));
beforeEach(() => { session.user = null; session.googleClientId = ''; session.localDevLogin = false; vi.clearAllMocks(); });
afterEach(() => { cleanup(); delete window.google; document.querySelectorAll('script[data-google-identity]').forEach(script => script.remove()); });

vi.mock('../context/SessionContext', () => ({
  useSession: () => session,
}));

const Destination = () => { const location = useLocation(); return <h1>{location.pathname}{location.search}{location.hash}</h1>; };
const renderLogin = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/login" element={<LoginPage />} /><Route path="*" element={<Destination />} />
</Routes></MemoryRouter>);
// A Google ID token whose payload carries the given name; the signature is irrelevant to the browser-side reader.
const idToken = (payload: object) => {
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));
  return ['header', encoded.replace(/=+$/u, '').replace(/\+/gu, '-').replace(/\//gu, '_'), 'signature'].join('.');
};
// Installs a fake Google Identity SDK and returns a function that completes its sign-in callback.
const mockGoogle = () => {
  session.googleClientId = 'test-client';
  let credentialCallback!: (response: { credential: string }) => void;
  window.google = { accounts: { id: {
    initialize: vi.fn(options => { credentialCallback = options.callback; }), renderButton: vi.fn(), prompt: vi.fn(), disableAutoSelect: vi.fn(),
  } } };
  const script = document.createElement('script'); script.dataset.googleIdentity = 'true'; document.head.append(script);
  return (credential: string) => act(async () => credentialCallback({ credential }));
};

describe('LoginPage', () => {
  test('returns a local login to the originating game action', async () => {
    session.localDevLogin = true;
    session.devLogin.mockResolvedValue(undefined);
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/add?game=shipyard#draft' })}`);
    await userEvent.click(screen.getByRole('button', { name: '以本機管理員登入' }));
    expect(await screen.findByRole('heading', { name: '/add?game=shipyard#draft' })).toBeInTheDocument();
    expect(session.devLogin).toHaveBeenCalledOnce();
  });

  test('offers the Google name as a nickname on first login and saves it only when accepted', async () => {
    const signIn = mockGoogle();
    session.googleLogin.mockImplementation(async () => { session.user = { id: 'user-3' }; return true; });
    const update = vi.spyOn(api, 'updateNickname').mockResolvedValue({ user: { id: 'user-3', roles: [], nickname: '李仲倫', showNickname: false } });
    vi.spyOn(localDb, 'invalidateHome').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'invalidateAllGames').mockResolvedValue(undefined);
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/catalog' })}`);
    await signIn(idToken({ name: '李 仲倫' }));

    expect(await screen.findByText('要用 Google 名稱「李仲倫」當暱稱嗎？')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '暱稱' })).toHaveValue('李仲倫');
    expect(screen.getByRole('checkbox', { name: /公開顯示暱稱/ })).not.toBeChecked();
    expect(screen.getByRole('link', { name: '帳號頁' })).toHaveAttribute('href', '/account');
    await userEvent.click(screen.getByRole('button', { name: '儲存並繼續' }));

    expect(update).toHaveBeenCalledWith('李仲倫', false);
    expect(await screen.findByRole('heading', { name: '/catalog' })).toBeInTheDocument();
  });

  test('lets a first-time user stay anonymous: 匿名 clears the field, then continuing saves nothing', async () => {
    const signIn = mockGoogle();
    session.googleLogin.mockImplementation(async () => { session.user = { id: 'user-3' }; return true; });
    const update = vi.spyOn(api, 'updateNickname');
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/catalog' })}`);
    await signIn(idToken({ name: '李仲倫' }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /公開顯示暱稱/ }));
    await userEvent.click(screen.getByRole('button', { name: '匿名' }));
    expect(screen.getByRole('textbox', { name: '暱稱' })).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /公開顯示暱稱/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '匿名' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '以匿名繼續' }));
    expect(await screen.findByRole('heading', { name: '/catalog' })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  test('offers an empty nickname when Google provides no name', async () => {
    const signIn = mockGoogle();
    session.googleLogin.mockImplementation(async () => { session.user = { id: 'user-2' }; return true; });
    renderLogin('/login');
    await signIn('not-a-jwt');

    expect(await screen.findByText('要設定暱稱嗎？')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '暱稱' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '以匿名繼續' })).toBeEnabled();
  });

  test('reads the Google name from an ID token in the browser', () => {
    expect(googleNameFromCredential(idToken({ name: 'Louie Chen' }))).toBe('LouieChen');
    expect(googleNameFromCredential(idToken({ email: 'a@example.com' }))).toBeUndefined();
    expect(googleNameFromCredential('broken')).toBeUndefined();
  });

  test('saves a changed nickname at the first-login step before continuing', async () => {
    const signIn = mockGoogle();
    session.googleLogin.mockImplementation(async () => { session.user = { id: 'user-1', nickname: '東東', showNickname: true }; return true; });
    const update = vi.spyOn(api, 'updateNickname').mockResolvedValue({ user: { id: 'user-1', roles: [], nickname: '小東', showNickname: false } });
    vi.spyOn(localDb, 'invalidateHome').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'invalidateAllGames').mockResolvedValue(undefined);
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/catalog' })}`);
    await signIn('token');

    expect(await screen.findByText('要設定暱稱嗎？')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '暱稱' })).toHaveValue('東東');
    const field = screen.getByRole('textbox', { name: '暱稱' });
    await userEvent.clear(field);
    await userEvent.type(field, '小東');
    await userEvent.click(screen.getByRole('checkbox', { name: /公開顯示暱稱/ }));
    await userEvent.click(screen.getByRole('button', { name: '儲存並繼續' }));

    expect(update).toHaveBeenCalledWith('小東', false);
    expect(await screen.findByRole('heading', { name: '/catalog' })).toBeInTheDocument();
  });

  test('skips the nickname step for a returning user', async () => {
    const signIn = mockGoogle();
    session.googleLogin.mockImplementation(async () => { session.user = { id: 'user-1', nickname: '東東' }; return false; });
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/catalog' })}`);
    await signIn('token');

    expect(await screen.findByRole('heading', { name: '/catalog' })).toBeInTheDocument();
  });

  test('keeps the return destination after Google rejects a login, then allows retry', async () => {
    const signIn = mockGoogle();
    session.googleLogin.mockRejectedValueOnce(new ApiError('invalid_google_identity', 401)).mockResolvedValueOnce(false);
    renderLogin(`/login?${new URLSearchParams({ returnTo: '/catalog?filter=ship' })}`);
    await signIn('rejected-token');
    expect(screen.getByRole('alert')).toHaveTextContent('可驗證的信箱身分');
    await signIn('retry-token');
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
