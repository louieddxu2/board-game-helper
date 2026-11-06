import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ATTRIBUTE_ACTIVITIES_FRESH_MS, confirmedComparison, mergeAttributeActivities, type ActivityCache } from '../lib/attributeActivityCache';
import { localDb } from '../lib/localDb';
import type { AttributeActivity } from '../shared/types';

export const useAttributeActivities = () => {
  const [activities, setActivities] = useState<AttributeActivity[]>();
  const active = useRef(true);
  const revision = useRef(0);
  const refreshing = useRef(false);
  const show = useCallback((entry: ActivityCache) => {
    if (active.current) setActivities(mergeAttributeActivities(entry.data.server, entry.data.confirmed));
  }, []);

  useEffect(() => {
    active.current = true;
    const refresh = async () => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        const startRevision = revision.current;
        const cached = await localDb.getAttributeActivities().catch(() => undefined);
        if (!active.current) return;
        if (cached && revision.current === startRevision) show(cached);
        if (cached && Date.now() - cached.cachedAt < ATTRIBUTE_ACTIVITIES_FRESH_MS) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        try {
          const result = await api.attributeActivities();
          const updated = await localDb.updateAttributeActivities({ server: result.activities }).catch(() => undefined);
          if (active.current) {
            revision.current += 1;
            if (updated) show(updated);
            else setActivities((current) => mergeAttributeActivities(result.activities, current ?? []));
          }
        } catch {
          // Leave the previous feed and its timestamp intact for the next opening.
        }
      } finally {
        refreshing.current = false;
      }
    };
    void refresh();
    window.addEventListener('online', refresh);
    return () => { active.current = false; window.removeEventListener('online', refresh); };
  }, [show]);

  const confirm = useCallback(async (items: AttributeActivity[] | undefined, responseId: string) => {
    const confirmed = confirmedComparison(items ?? [], responseId);
    try {
      // An idempotent retry may return no snapshot; revalidate next time.
      const entry = await localDb.updateAttributeActivities(confirmed ? { confirmed } : { invalidate: true });
      revision.current += 1;
      show(entry);
    } catch {
      if (confirmed && active.current) setActivities((current) => mergeAttributeActivities([confirmed], current ?? []));
    }
    return Boolean(confirmed);
  }, [show]);
  return { activities, confirm };
};
