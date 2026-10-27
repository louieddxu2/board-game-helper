// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { gamePreview } from '../src/shared/gamePreview';
import { gamePreviewHtml } from './gamePreviewHtml';

const shell = readFileSync('index.html', 'utf8');
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

test('provides the game title, public summary, canonical link, and absolute image without JavaScript', () => {
  const preview = gamePreview({ slug: '船廠', displayName: '船廠', englishName: 'Shipyard', statement: '三人局只有五個方塊。' }, 'https://rules.example');
  const html = parse(gamePreviewHtml(shell, preview));
  expect(html.title).toBe('船廠｜玩錯的桌遊規則');
  expect(html.querySelector('meta[property="og:description"]')?.getAttribute('content')).toContain('三人局只有五個方塊');
  expect(html.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://rules.example/games/%E8%88%B9%E5%BB%A0');
  expect(html.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(preview.url);
  expect(html.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://rules.example/social-preview.png');
  expect(html.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(preview.title);
});

test('keeps quotes, markup, ampersands, and replacement markers as plain text', () => {
  const text = '\"></title><script>alert(1)</script> & $&';
  const preview = gamePreview({ slug: 'safe', displayName: text, statement: text }, 'https://rules.example');
  const html = parse(gamePreviewHtml(shell, preview));
  expect(html.title).toBe(preview.title);
  expect(html.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe(text);
  expect(html.querySelectorAll('script')).toHaveLength(parse(shell).querySelectorAll('script').length);
});

test('bounds the description without cutting surrogate pairs and replaces existing tags once', () => {
  const preview = gamePreview({ slug: 'long', displayName: 'Long', statement: '🎲'.repeat(200) }, 'https://rules.example');
  expect(Array.from(preview.description)).toHaveLength(160);
  expect(preview.description.endsWith('…')).toBe(true);
  const html = parse(gamePreviewHtml(gamePreviewHtml(shell, preview), preview));
  expect(html.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
  expect(html.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
});
