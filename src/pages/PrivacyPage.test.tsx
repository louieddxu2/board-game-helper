// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

afterEach(cleanup);

describe('PrivacyPage', () => {
  test('states the data collector and how users can exercise their rights', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: '個人資料告知事項' })).toBeInTheDocument();
    expect(screen.getByText(/黃紹東/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'louieddxu2@gmail.com' })[0]).toHaveAttribute('href', 'mailto:louieddxu2@gmail.com');
    expect(screen.getByRole('heading', { name: '你的權利與申請方式' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '不提供資料的影響' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '編輯者與管理員邀請' })).toBeInTheDocument();
    expect(screen.getByText(/這些資料不是直接向受邀者蒐集/)).toBeInTheDocument();
    expect(screen.getByText(/本站不保證資料固定儲存於台灣/)).toBeInTheDocument();
    expect(screen.getByText(/在遊戲頁取消收藏、在規則卡片撤回投票/)).toBeInTheDocument();
  });

  test('describes general contribution limits and editor review permissions', () => {
    render(<PrivacyPage />);

    expect(screen.getByText('有限度地建立規則')).toBeInTheDocument();
    expect(screen.getByText('有勾選公開暱稱的編輯者可以審核一般登入玩家所建立的規則。')).toBeInTheDocument();
    expect(screen.getByText('具體而言，一般登入玩家只能建立上限6條未審核的規則，建立1款未審核的遊戲名稱。')).toBeInTheDocument();
    expect(screen.getByText('第三方行為分析服務')).toBeInTheDocument();
    expect(screen.getByText(/建立、修改或審核標示/)).toBeInTheDocument();
    expect(screen.queryByText(/目前採用保守的授權方式/)).not.toBeInTheDocument();
  });
});
