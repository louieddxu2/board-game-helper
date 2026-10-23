import type { RuleCard } from '../shared/types';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const htmlText = (text: string) => escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');

export function buildRuleClipboard(rule: RuleCard, url: string) {
  const sections = [
    `✅ ${rule.statement}`,
    ...(rule.commonMistake ? [`❌ ${rule.commonMistake}`] : []),
    ...(rule.details ? [`補充說明：${rule.details}`] : []),
  ];
  return {
    text: sections.join('\n\n'),
    html: `<p><a href="${escapeHtml(url)}">${htmlText(sections[0])}</a></p>`
      + sections.slice(1).map((section) => `<p>${htmlText(section)}</p>`).join(''),
  };
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
