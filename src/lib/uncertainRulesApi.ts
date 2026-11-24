import type { UncertainRule } from '../shared/types';
import { mutation, uncachedRead } from './api';

type UncertainRuleInput = { question?: string; tableRuling?: string; checked?: boolean };

const path = (gameId: string, ruleId?: string) =>
  `/api/games/${encodeURIComponent(gameId)}/uncertain-rules${ruleId ? `/${encodeURIComponent(ruleId)}` : ''}`;

export const uncertainRulesApi = {
  list: (gameId: string) => uncachedRead<{ uncertainRules: UncertainRule[] }>(path(gameId), 'uncertain rules are an admin-only working list that is read only when opened'),
  create: (gameId: string, input: UncertainRuleInput & { question: string }) =>
    mutation<{ uncertainRule: UncertainRule }>(path(gameId), { method: 'POST', body: JSON.stringify(input) }),
  update: (gameId: string, ruleId: string, input: UncertainRuleInput) =>
    mutation<{ uncertainRule: UncertainRule }>(path(gameId, ruleId), { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (gameId: string, ruleId: string) => mutation<{ ok: true }>(path(gameId, ruleId), { method: 'DELETE', body: '{}' }),
};
