// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SessionProvider, useSession } from './SessionContext';

const apiMock = vi.hoisted(() => ({
  session: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('../lib/pendingSync', () => ({ flushPendingSubmissions: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const Probe = () => {
  const { user, logout } = useSession();
  return <>
    <span>{user?.id ?? 'signed-out'}</span>
    <button type="button" onClick={() => { void logout().catch(() => undefined); }}>登出</button>
  </>;
};

describe('SessionProvider logout', () => {
  test('clears the local session even when the logout API fails', async () => {
    apiMock.session.mockResolvedValue({
      user: { id: 'user-1', maskedEmail: 'u***r@example.com', roles: [] },
      googleClientId: null,
      localDevLogin: false,
    });
    apiMock.logout.mockRejectedValue(new Error('network unavailable'));

    render(<SessionProvider><Probe /></SessionProvider>);

    await waitFor(() => expect(screen.getByText('user-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '登出' }));

    await waitFor(() => expect(screen.getByText('signed-out')).toBeInTheDocument());
    expect(apiMock.logout).toHaveBeenCalledOnce();
  });
});
