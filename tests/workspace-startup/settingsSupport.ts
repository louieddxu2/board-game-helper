import type { Locator } from '@playwright/test';

export const chooseWorkspaceSetting = async (dialog: Locator, name: string, option: string) => {
  await dialog.getByRole('combobox', { name }).tap();
  await dialog.getByRole('listbox', { name }).getByRole('option', { name: option, exact: true }).tap();
};
