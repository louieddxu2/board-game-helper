import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

for (const side of ['left', 'right'] as const) {
  test(`reused ${side} game does not retain selected color under the pointer`, async ({ page }) => {
    const card = `<button class="attribute-game-card is-${side}" aria-label="重複遊戲較高" aria-pressed="false">重複遊戲</button>`;
    await page.setContent(`<section class="attribute-vote-page">${card}</section>`);
    await page.addStyleTag({ content: readFileSync('src/styles.css', 'utf8') });
    const button = page.getByRole('button', { name: '重複遊戲較高' });
    await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const neutral = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.click();
    await button.evaluate((element) => {
      element.classList.add('is-selected');
      element.setAttribute('aria-pressed', 'true');
    });
    await expect(button).toHaveCSS('background-color', side === 'left' ? 'rgb(248, 236, 231)' : 'rgb(232, 243, 240)');
    // React reuses this button for the same game on the next question.
    // Clear the answer while leaving the pointer where the user clicked.
    await button.evaluate((element) => {
      element.classList.remove('is-selected');
      element.setAttribute('aria-pressed', 'false');
    });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveCSS('background-color', neutral);
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await button.focus();
    await expect(button).toHaveCSS('outline-style', 'solid');
    await expect(button).toHaveCSS('background-color', neutral);
  });
}
