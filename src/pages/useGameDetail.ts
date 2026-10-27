import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { api, ApiError } from '../lib/api';
import { localDb } from '../lib/localDb';
import { hydrateGameTags } from '../lib/tagHydration';
import type { GameDetail } from '../shared/types';

interface GameState {
  identifier: string;
  game?: GameDetail;
  loading: boolean;
  error?: 'not-found' | 'unavailable';
}

export const useGameDetail = (identifier: string, justAdded?: number) => {
  const [state, setState] = useState<GameState>({ identifier, loading: true });
  const activeIdentifier = useRef<string | undefined>(identifier);
  const requestId = useRef(0);

  const load = useCallback(async (invalidate = false) => {
    if (activeIdentifier.current !== identifier) return;
    const request = ++requestId.current;
    const isCurrent = () => activeIdentifier.current === identifier && requestId.current === request;
    setState(current => ({ identifier, game: current.identifier === identifier ? current.game : undefined, loading: true }));
    let updateReceived = false;
    let hydrationId = 0;
    const apply = ({ game }: { game: GameDetail }) => {
      if (!isCurrent()) return;
      const hydration = ++hydrationId;
      setState({ identifier, game, loading: false });
      // Optional tag names must not block reading the rules or overwrite votes.
      void hydrateGameTags(game).then(hydrated => {
        if (!isCurrent() || hydration !== hydrationId) return;
        const tags = new Map(hydrated.rules.map(rule => [rule.id, rule.tags]));
        setState(current => {
          if (current.identifier !== identifier || !current.game) return current;
          let changed = false;
          const rules = current.game.rules.map(rule => {
            const updated = tags.get(rule.id);
            if (!updated || JSON.stringify(updated) === JSON.stringify(rule.tags)) return rule;
            changed = true;
            return { ...rule, tags: updated };
          });
          return changed ? { ...current, game: { ...current.game, rules } } : current;
        });
      }).catch(() => undefined);
    };
    const fail = (caught: unknown) => {
      if (!isCurrent()) return;
      const notFound = caught instanceof ApiError && caught.status === 404;
      setState(current => ({
        identifier,
        game: !notFound && current.identifier === identifier ? current.game : undefined,
        loading: false,
        error: notFound ? 'not-found' : 'unavailable',
      }));
    };
    try {
      if (invalidate) await localDb.invalidateGame(identifier);
      const response = await api.game(identifier, false, updated => {
        updateReceived = true;
        apply(updated);
      });
      if (!updateReceived) apply(response);
    } catch (caught) {
      fail(caught);
    }
  }, [identifier]);

  useEffect(() => {
    activeIdentifier.current = identifier;
    void load(Boolean(justAdded));
    return () => { activeIdentifier.current = undefined; requestId.current += 1; };
  }, [identifier, justAdded, load]);

  const reload = useCallback(() => load(true), [load]);
  const setGame = useCallback((update: SetStateAction<GameDetail | undefined>) => {
    setState(current => current.identifier !== identifier ? current : {
      ...current, game: typeof update === 'function' ? update(current.game) : update,
    });
  }, [identifier]);
  const current: GameState = state.identifier === identifier ? state : { identifier, loading: true };
  return { ...current, reload, setGame };
};
