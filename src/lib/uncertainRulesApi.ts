import type { RuleCategory, UncertainRule } from '../shared/types';
import { mutation, uncachedRead } from './api';
import { localDb } from './localDb';

type UncertainRuleInput = {
  question?: string;
  tableRuling?: string;
  details?: string;
  categories?: RuleCategory[];
  playerCounts?: number[];
  editionNotes?: string[];
  checked?: boolean;
};
type GameTarget = { gameId: string } | { newGame: { displayName: string; englishName?: string } };

const path = (gameId: string, ruleId?: string) =>
  `/api/games/${encodeURIComponent(gameId)}/uncertain-rules${ruleId ? `/${encodeURIComponent(ruleId)}` : ''}`;

export const uncertainRulesApi = {
  list: (gameId: string) => uncachedRead<{ uncertainRules: UncertainRule[] }>(path(gameId), 'uncertain rules are an admin-only working list that is read only when opened'),
  /** Records several questions for one game: an existing one by id, or a new one by name (the server reuses a game that already has that name). */
  create: async (target: GameTarget, rules: Array<UncertainRuleInput & { question: string }>) => {
    const response = await mutation<{ uncertainRules: UncertainRule[]; gameSlug: string; gameCreated: boolean }>('/api/uncertain-rules', { method: 'POST', body: JSON.stringify({ ...target, rules }) });
    // The game list syncs on its own every ten minutes; a game created just now must be searchable at once.
    if (response.gameCreated) await localDb.invalidateGameCatalogSync().catch(() => undefined);
    return response;
  },
  update: (gameId: string, ruleId: string, input: UncertainRuleInput) =>
    mutation<{ uncertainRule: UncertainRule }>(path(gameId, ruleId), { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (gameId: string, ruleId: string) => mutation<{ ok: true }>(path(gameId, ruleId), { method: 'DELETE', body: '{}' }),
};
