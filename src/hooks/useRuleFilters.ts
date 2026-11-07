import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { readRuleFilterParams, type RuleFilterPatch, type RuleFilterView, writeRuleFilterParams } from '../lib/ruleFilterParams';
import type { RuleCard, TagSummary } from '../shared/types';
import { useRuleFilterModel } from './useRuleFilterModel';

export type { RuleFilterState } from './useRuleFilterModel';

/** Game page filters: kept in the URL so copied, shared and reloaded links keep the same view. */
export const useRuleFilters = (rules: RuleCard[], classificationTags: TagSummary[]) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const view = useMemo(() => readRuleFilterParams(params), [params]);
  // The search box keeps its own text so typing never waits for a navigation.
  const [ruleQuery, setRuleQueryText] = useState(() => params.get('find') ?? '');
  useEffect(() => {
    // Filter updates replace the entry; pushed or traversed URLs (such as a search result) bring their own query.
    if (navigationType !== 'REPLACE') setRuleQueryText(params.get('find') ?? '');
  }, [location.key]);

  const applyPatch = (patch: RuleFilterPatch) => {
    if (patch.query !== undefined) setRuleQueryText(patch.query);
    const search = writeRuleFilterParams(params, patch).toString();
    // Keep the hash so a shared rule target stays in the link and the page does not scroll.
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  };
  return useRuleFilterModel(rules, classificationTags, view, ruleQuery, applyPatch);
};

const EMPTY_VIEW: RuleFilterView = { category: 'all', tags: [], playerCounts: [], editions: [] };

/** The same filters held in component state, for views that must not change the page URL. */
export const useLocalRuleFilters = (rules: RuleCard[], classificationTags: TagSummary[]) => {
  const [view, setView] = useState(EMPTY_VIEW);
  const [ruleQuery, setRuleQuery] = useState('');
  const applyPatch = ({ query, ...patch }: RuleFilterPatch) => {
    if (query !== undefined) setRuleQuery(query);
    setView((current) => ({ ...current, ...patch }));
  };
  return useRuleFilterModel(rules, classificationTags, view, ruleQuery, applyPatch);
};
