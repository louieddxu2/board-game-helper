// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { sitePageTitle } from '../lib/gameSeo';
import { usePageTitle } from './usePageTitle';

const Page = ({ title }: { title: string }) => { usePageTitle(title); return null; };
afterEach(cleanup);

test('names the tab for a page and gives the title back on leave', () => {
  document.title = '玩錯的桌遊規則';
  const { rerender, unmount } = render(<Page title={sitePageTitle('登入')} />);
  expect(document.title).toBe('登入｜玩錯的桌遊規則');
  rerender(<Page title="動態表格" />);
  expect(document.title).toBe('動態表格');
  unmount();
  expect(document.title).toBe('玩錯的桌遊規則');
});
