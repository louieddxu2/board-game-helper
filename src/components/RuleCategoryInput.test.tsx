import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { RuleCategoryInput } from './RuleCategoryInput';

describe('RuleCategoryInput', () => {
  test('supports selecting more than one rule category', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<RuleCategoryInput value={[]} onChange={onChange} />);

    await user.click(screen.getByRole('checkbox', { name: '教學、設置、開局' }));
    expect(onChange).toHaveBeenLastCalledWith(['teaching_setup_opening']);

    view.rerender(<RuleCategoryInput value={['teaching_setup_opening']} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: '流程、終局、計分' }));
    expect(onChange).toHaveBeenLastCalledWith(['teaching_setup_opening', 'flow_endgame_scoring']);
  });
});
