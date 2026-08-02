// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

describe('PrivacyPage', () => {
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
