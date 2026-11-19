import type { RuleCard } from '../shared/types';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

/** The copied and shared body: the game name (when known), then the rule's sections, one per line. */
const ruleLines = (rule: RuleCard, gameName?: string) => [
  ...(gameName?.trim() ? [gameName.trim()] : []),
  `✅ ${rule.statement}`,
  ...(rule.commonMistake ? [`❌ ${rule.commonMistake}`] : []),
  ...(rule.details ? [`🔍 ${rule.details}`] : []),
].join('\n').split(/\r\n|\r|\n/);

/**
 * Each line carries its own link and lines are joined by `<br>` outside the links, so the
 * paste stays one paragraph. Rich editors such as 方格子 drop a `<br>` inside a link.
 */
export function buildRuleClipboard(rule: RuleCard, url: string, gameName?: string) {
  const lines = ruleLines(rule, gameName);
  const href = escapeHtml(url);
  return {
    text: lines.join('\n'),
    html: lines.map((line) => (line.trim() ? `<a href="${href}">${escapeHtml(line)}</a>` : '')).join('<br>'),
  };
}

/**
 * The shared body is the copied body. Many share targets drop the share title,
 * so the game name leads the text; the link travels separately as the share URL.
 */
export function buildRuleShareText(rule: RuleCard, gameName?: string) {
  return ruleLines(rule, gameName).join('\n');
}

export async function copyRuleContent(rule: RuleCard, url: string, gameName?: string) {
  const { text, html } = buildRuleClipboard(rule, url, gameName);
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
