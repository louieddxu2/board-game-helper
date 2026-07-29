import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AdminTagEditor } from './AdminTagEditor';

describe('AdminTagEditor', () => {
  test('lets an admin edit a tag name and aliases together', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AdminTagEditor
      tag={{ id: 't1', slug: 'setup', name: '設置', aliases: ['準備'], isPublic: false, usageCount: 2 }}
      onSave={onSave}
      onTogglePublic={vi.fn()}
    />);

    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.clear(screen.getByLabelText('Tag 名稱'));
    await user.type(screen.getByLabelText('Tag 名稱'), '遊戲設置');
    await user.clear(screen.getByLabelText('別名'));
    await user.type(screen.getByLabelText('別名'), '準備, 開局');
    await user.click(screen.getByRole('checkbox', { name: '教學、設置、開局' }));
    await user.type(screen.getByLabelText(/自動偵測關鍵字/), '準備階段, 初始資源');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    expect(onSave).toHaveBeenCalledWith({
      name: '遊戲設置',
      aliases: ['準備', '開局'],
      categoryHints: ['teaching_setup_opening'],
      detectionKeywords: ['準備階段', '初始資源'],
    });
  });
});
