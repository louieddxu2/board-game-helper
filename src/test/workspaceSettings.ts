import type { UserEvent } from '@testing-library/user-event';
import { within } from '@testing-library/react';

/** Select an option from the workspace's custom, keyboard-friendly chooser. */
export const chooseWorkspaceSetting = async (user: UserEvent, container: HTMLElement, ariaLabel: string, optionLabel: string) => {
  const scope = within(container);
  await user.click(scope.getByRole('combobox', { name: ariaLabel }));
  await user.click(within(scope.getByRole('listbox', { name: ariaLabel })).getByRole('option', { name: optionLabel }));
};
