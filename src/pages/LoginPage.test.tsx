// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LoginPage, googleLoginErrorMessage } from './LoginPage';
import { ApiError } from '../lib/api';

afterEach(cleanup);

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({
    user: null,
    googleClientId: '',
    localDevLogin: false,
    devLogin: vi.fn(),
    googleLogin: vi.fn(),
  }),
}));

describe('LoginPage', () => {
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
