import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SessionUser } from '../shared/types';
import { RoleGrantNotice, ROLE_NOTICE_WINDOW_MS, roleNoticeKey, shouldShowRoleNotice } from './RoleGrantNotice';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('../context/SessionContext', () => ({ useSession: () => session }));

const now = 1_800_000_000_000;
const editor: SessionUser = { id: 'user-2', roles: ['editor'], roleGrantedAt: now - 1000 };

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('role grant notice', () => {
  test('appears only for a recent editor grant that this device has not acknowledged', () => {
    expect(shouldShowRoleNotice(editor, now)).toBe(true);
    expect(shouldShowRoleNotice({ ...editor, roleGrantedAt: now - ROLE_NOTICE_WINDOW_MS }, now)).toBe(false);
    expect(shouldShowRoleNotice({ ...editor, roles: [] }, now)).toBe(false);
    expect(shouldShowRoleNotice({ ...editor, roles: ['admin'] }, now)).toBe(false);
    expect(shouldShowRoleNotice({ ...editor, roleGrantedAt: undefined }, now)).toBe(false);
    localStorage.setItem(roleNoticeKey(editor), '1');
    expect(shouldShowRoleNotice(editor, now)).toBe(false);
  });

  test('greets the account nickname and signs off with the author name', () => {
    session.user = { ...editor, nickname: '芋頭' };
    render(<MemoryRouter><RoleGrantNotice /></MemoryRouter>);

    expect(screen.getByRole('dialog', { name: '芋頭，您已被授權為編輯者。' })).toBeTruthy();
    expect(screen.getByText((_, node) => node?.tagName === 'P' && node.textContent === '可於FB搜尋黃紹東，\n或是Line ID:ddxu2聯繫我。')).toBeTruthy();
    expect(screen.getByText('黃紹東(東東)').className).toBe('role-grant-signature');
  });

  test('closes on the first click and stays closed after a reload', () => {
    session.user = editor;
    const { unmount } = render(<MemoryRouter><RoleGrantNotice /></MemoryRouter>);

    expect(screen.getByRole('dialog', { name: '您已被授權為編輯者。' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    render(<MemoryRouter><RoleGrantNotice /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('stays off the attribute voting pages', () => {
    session.user = editor;
    render(<MemoryRouter initialEntries={['/attributes']}><RoleGrantNotice /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
