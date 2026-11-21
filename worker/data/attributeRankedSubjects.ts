import { rankingPlayerOrder, type StoredAttributeRankingBallot } from '../../src/shared/attributeRankingBallot';

export function rankedAttributeSubjects(ballot: StoredAttributeRankingBallot, available?: ReadonlySet<string>) {
  if (ballot.version !== 1) throw new Error('unsupported_attribute_ranking_version');
  const order = rankingPlayerOrder(ballot);
  if (ballot.highPole === 'low') order.reverse();
  // A game merge can map several entries to one score state. Keep its
  // highest canonical position; drop retired subjects before scoring.
  const subjects = new Set<string>();
  for (const id of order) {
    const subject = ballot.subjectMappings?.[id] ?? id;
    if (!available || available.has(subject)) subjects.add(subject);
  }
  return [...subjects];
}
