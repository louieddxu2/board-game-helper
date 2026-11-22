/**
 * How much of a draft already appears in an existing rule, from 0 (nothing) to 1 (all of it).
 * Chinese has no word breaks, so text is compared as overlapping two-character pieces after
 * removing spaces, punctuation and case differences. Drafts are usually shorter and worded
 * differently, so the score asks how much of the draft is covered, not how alike the two lengths are.
 */
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

const pieces = (text: string) => {
  const normalized = normalize(text);
  const counts = new Map<string, number>();
  for (let index = 0; index < normalized.length - 1; index++) {
    const piece = normalized.slice(index, index + 2);
    counts.set(piece, (counts.get(piece) ?? 0) + 1);
  }
  return counts;
};

const total = (counts: Map<string, number>) => Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

export const draftCoverage = (existing: string, draft: string): number => {
  const draftPieces = pieces(draft);
  const existingPieces = pieces(existing);
  const size = total(draftPieces);
  if (size === 0 || existingPieces.size === 0) return 0;
  let shared = 0;
  draftPieces.forEach((count, piece) => { shared += Math.min(count, existingPieces.get(piece) ?? 0); });
  return shared / size;
};

/** Scores at or above this read as a possible duplicate; a shared tag adds a small bonus. */
export const SIMILAR_RULE_THRESHOLD = 0.35;
const SHARED_TAG_BONUS = 0.05;
/** A draft this short covers almost any rule, so it still sorts the list but flags nothing. */
const MIN_FLAG_PIECES = 4;

export type DraftRule = { statement: string; tags: string[] };
/** The parts of an existing rule a draft is compared with, each on its own so long notes do not dilute a match. */
export type ExistingRuleText = { statement: string; commonMistake?: string | null; details?: string | null; tags: string[] };
export type DraftMatch = { draftIndex: number; score: number; similar: boolean };

/** The draft (by its index) an existing rule most resembles, with whether it is close enough to flag. */
export const closestDraft = (rule: ExistingRuleText, drafts: DraftRule[]): DraftMatch | undefined => {
  const fields = [rule.statement, rule.commonMistake, rule.details].filter((text): text is string => Boolean(text));
  let best: DraftMatch | undefined;
  drafts.forEach((draft, draftIndex) => {
    const draftPieces = total(pieces(draft.statement));
    if (draftPieces === 0) return;
    const sharedTag = draft.tags.some((name) => rule.tags.includes(name));
    const score = Math.max(...fields.map((field) => draftCoverage(field, draft.statement))) + (sharedTag ? SHARED_TAG_BONUS : 0);
    if (!best || score > best.score) {
      best = { draftIndex, score, similar: score >= SIMILAR_RULE_THRESHOLD && draftPieces >= MIN_FLAG_PIECES };
    }
  });
  return best;
};
