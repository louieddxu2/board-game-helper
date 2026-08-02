// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LoginPage } from './LoginPage';

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
});
