/**
 * How alike two rule statements read, from 0 (nothing shared) to 1 (the same text).
 * Chinese has no word breaks, so the text is compared as overlapping two-character pieces
 * after removing spaces, punctuation and case differences (the Dice coefficient).
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

export const ruleTextSimilarity = (left: string, right: string): number => {
  const a = pieces(left);
  const b = pieces(right);
  const size = total(a) + total(b);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  a.forEach((count, piece) => { shared += Math.min(count, b.get(piece) ?? 0); });
  return (2 * shared) / size;
};

/** Scores at or above this read as a possible duplicate; a shared tag adds a small bonus. */
export const SIMILAR_RULE_THRESHOLD = 0.35;
const SHARED_TAG_BONUS = 0.05;

export type DraftRule = { statement: string; tags: string[] };

/** The draft (by its index) an existing rule most resembles, when it is close enough to flag. */
export const closestDraft = (statement: string, tags: string[], drafts: DraftRule[]): { draftIndex: number; score: number } | undefined => {
  let best: { draftIndex: number; score: number } | undefined;
  drafts.forEach((draft, draftIndex) => {
    if (normalize(draft.statement).length < 2) return;
    const sharedTag = draft.tags.some((name) => tags.includes(name));
    const score = ruleTextSimilarity(statement, draft.statement) + (sharedTag ? SHARED_TAG_BONUS : 0);
    if (score >= SIMILAR_RULE_THRESHOLD && (!best || score > best.score)) best = { draftIndex, score };
  });
  return best;
};
