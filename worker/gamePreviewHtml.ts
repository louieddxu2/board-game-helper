import { gamePreview } from '../src/shared/gamePreview';

const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

/** Only rewrite the maintained application shell; never treat game text as markup. */
export const gamePreviewHtml = (html: string, preview: ReturnType<typeof gamePreview>) => {
  html = html.replace(/<title>[\s\S]*?<\/title>/iu, () => `<title>${escapeHtml(preview.title)}</title>`);
  for (const [attribute, name, value] of [
    ['name', 'description', preview.description],
    ['property', 'og:title', preview.title],
    ['property', 'og:description', preview.description],
    ['property', 'og:url', preview.url],
    ['property', 'og:image', preview.image],
    ['name', 'twitter:title', preview.title],
    ['name', 'twitter:description', preview.description],
    ['name', 'twitter:image', preview.image],
  ]) {
    const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}="${name}"[^>]*>`, 'iu');
    const tag = `<meta ${attribute}="${name}" content="${escapeHtml(value)}" />`;
    html = pattern.test(html) ? html.replace(pattern, () => tag) : html.replace('</head>', () => `${tag}\n</head>`);
  }
  const canonical = `<link rel="canonical" href="${escapeHtml(preview.url)}" />`;
  const pattern = /<link\b[^>]*\brel="canonical"[^>]*>/iu;
  return pattern.test(html) ? html.replace(pattern, () => canonical) : html.replace('</head>', () => `${canonical}\n</head>`);
};
