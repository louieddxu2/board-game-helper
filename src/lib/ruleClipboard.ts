import type { RuleCard } from '../shared/types';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const htmlText = (text: string) => escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');

const ruleSections = (rule: RuleCard) => [
  `✅ ${rule.statement}`,
  ...(rule.commonMistake ? [`❌ ${rule.commonMistake}`] : []),
  ...(rule.details ? [`補充說明：${rule.details}`] : []),
];

export function buildRuleClipboard(rule: RuleCard, url: string) {
  const sections = ruleSections(rule);
  return {
    text: sections.join('\n'),
    html: `<a href="${escapeHtml(url)}">${sections.map(htmlText).join('<br>')}</a>`,
  };
}

/**
 * The shared body is the copied body. Many share targets drop the share title,
 * so the game name leads the text; the link travels separately as the share URL.
 */
export function buildRuleShareText(rule: RuleCard, gameName?: string) {
  const body = ruleSections(rule).join('\n');
  return gameName?.trim() ? `${gameName.trim()}\n${body}` : body;
}

export async function copyRuleContent(rule: RuleCard, url: string) {
  const { text, html } = buildRuleClipboard(rule, url);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return 'rich';
    } catch {
      // Browsers may expose the API but reject HTML clipboard writes.
    }
  }
  await navigator.clipboard.writeText(text);
  return 'plain';
}
