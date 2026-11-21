import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Replace only the in-memory ranking step in a benchmark bundle. Requests,
// score queries, leases, transactions, and publication use the real Worker.
export const bidirectionalCostVariant = {
  name: 'bidirectional-ranking-cost',
  setup(build) {
    build.onLoad({ filter: /[\\/]attributeOnlineScoring\.ts$/ }, ({ path }) => {
      let source = readFileSync(path, 'utf8');
      const replace = (from, to) => {
        assert.equal(source.split(from).length, 2, `Ranking cost benchmark lost its insertion point: ${from}`);
        source = source.replace(from, () => to);
      };
      const candidateModule = resolve('scripts/ranking-research/order-candidates.ts').replaceAll('\\', '/');
      replace("import { expandStoredRankingResponse } from '../../src/shared/attributeRankingBallot';",
        `import { rankingPlayerOrder, type StoredAttributeRankingBallot } from '../../src/shared/attributeRankingBallot';
import { applyCandidate } from ${JSON.stringify(candidateModule)};`);
      replace(".flatMap(expandStoredRankingResponse);", `;
  const rankings = new Map(rows.flatMap((row) => {
    if (!row.ranking_json) return [];
    const ranking = JSON.parse(row.ranking_json) as StoredAttributeRankingBallot;
    const ids = rankingPlayerOrder(ranking).map((id) => ranking.subjectMappings?.[id] ?? id);
    if (ranking.version !== 1 || ids.length < 2 || new Set(ids).size !== ids.length) {
      throw new Error('Unexpected ballot in ranking cost fixture');
    }
    return [[row.receipt_rowid, { ids, lowPole: ranking.highPole === 'low' }]] as const;
  }));`);
      replace('for (const id of [row.subject_a_id, row.subject_b_id])',
        'for (const id of rankings.get(row.receipt_rowid)?.ids ?? [row.subject_a_id, row.subject_b_id])');
      const applyRatings = '    if (row.rating_a != null && states.has(a))';
      replace(applyRatings, `    const ranking = rankings.get(row.receipt_rowid);
    if (ranking) {
      const keys = ranking.ids.map((id) => stateKey(id, row.attribute_id!));
      const players = keys.map((key) => {
        const state = states.get(key);
        if (!state) throw new Error('Missing score target in ranking cost fixture');
        return state;
      });
      if (keys.some((key) => lastReceipt.get(key) !== row.receipt_rowid && timestamps.get(key)! >= row.created_at)) {
        outOfOrder = true;
      }
      applyCandidate(players, { order: players.map((_, i) => i), lowPole: ranking.lowPole, weight: row.online_weight! },
        { method: 'bidirectional', slopeFactor: 1, evidenceScale: 2, softBounds: true });
      players.forEach((state, i) => {
        // Preserve today’s visible comparison/evidence counts to isolate the score change.
        const comparisons = i === 0 || i === players.length - 1 ? 1 : 2;
        update(keys[i], { ...state, comparisonCount: state.comparisonCount + comparisons,
          decisiveComparisonCount: state.decisiveComparisonCount + comparisons, evidenceCount: state.evidenceCount + comparisons });
      });
      continue;
    }
${applyRatings}`);
      return { contents: source, loader: 'ts', resolveDir: dirname(path) };
    });
  },
};
