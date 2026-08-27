import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AdminAttributeExpansionEditor } from './AdminAttributeExpansionEditor';

describe('AdminAttributeExpansionEditor', () => {
  test('edits an expansion English name and newline-separated aliases', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AdminAttributeExpansionEditor
      expansion={{
        subjectId: 'config-1', componentOrder: 1, displayName: '馬可波羅＋威尼斯擴',
        baseGameName: '馬可波羅', expansionName: '威尼斯擴',
        englishName: 'Agents of Venice', aliases: ['Venice Agents'], bggId: 232945,
      }}
      onSave={onSave}
    />);

    await user.clear(screen.getByLabelText('英文名稱'));
    await user.type(screen.getByLabelText('英文名稱'), 'Agents of Venice');
    await user.clear(screen.getByLabelText(/可搜尋的別名/));
    await user.type(screen.getByLabelText(/可搜尋的別名/), 'Venice Agents\nAgents Venice');
    await user.click(screen.getByRole('button', { name: '儲存擴充資料' }));

    expect(onSave).toHaveBeenCalledWith({
      englishName: 'Agents of Venice',
      aliases: ['Venice Agents', 'Agents Venice'],
    });
  });
});
