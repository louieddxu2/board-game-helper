import type { UncertainRule } from '../shared/types';

export interface UncertainRulePostGame {
  displayName: string;
  englishName?: string;
}

/**
 * One BoardGameGeek forum post asking a game's selected uncertain rules as Q1, Q2, ….
 * The fixed frame is English already; only the questions and table rulings still need translating.
 */
export function buildUncertainRulePost(game: UncertainRulePostGame, rules: UncertainRule[]) {
  const name = game.englishName?.trim() || game.displayName.trim();
  const plural = rules.length > 1;
  // Claim a search only when every selected question was looked up without finding an answer.
  const allChecked = rules.every((rule) => rule.checkedAt !== null);
  const lines = [
    `Title: Rules question${plural ? 's' : ''} about ${name}`,
    '',
    `Hi all, we ran into ${plural ? 'these rules questions' : 'this rules question'} while playing ${name}.`,
    ...(allChecked ? ['We checked the rulebook and the forums but could not find an answer.'] : []),
  ];
  rules.forEach((rule, index) => {
    lines.push('', `${plural ? `Q${index + 1}. ` : 'Q. '}${rule.question.trim()}`);
    if (rule.tableRuling?.trim()) lines.push(`How we played it for now: ${rule.tableRuling.trim()}`);
  });
  lines.push('', 'Thanks for any help!');
  return lines.join('\n');
}

const AI_INSTRUCTION = [
  '請把下面這篇 BoardGameGeek 規則提問翻成自然的英文。',
  '保留標題、Q 編號與段落結構；已經是英文的部分維持原樣。',
  '不要補充、刪減或解釋任何規則內容，只輸出翻譯後的文章。',
].join('\n');

/** The same post, led by an instruction for an AI translator. */
export const buildUncertainRuleAiPrompt = (game: UncertainRulePostGame, rules: UncertainRule[]) =>
  `${AI_INSTRUCTION}\n\n---\n\n${buildUncertainRulePost(game, rules)}`;
