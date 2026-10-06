import { useLayoutEffect, useMemo, useRef } from 'react';

export type WorkspaceReadScope = 'active' | 'all' | 'history';
export interface WorkspaceReadiness {
  isReady(scope: WorkspaceReadScope): boolean;
  ensure(scope: WorkspaceReadScope): Promise<void>;
  onError(error: unknown): void;
  ownerKey?(): string | undefined;
}

/** Resume against the latest render, so an operation cannot capture an incomplete table. */
export const useReadyWorkspaceActions = <T extends object>(actions: T, scopes: Partial<Record<keyof T, WorkspaceReadScope>>, readiness: WorkspaceReadiness): T => {
  const latest = useRef({ actions, readiness });
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { latest.current = { actions, readiness }; });
  return useMemo(() => Object.fromEntries(Object.entries(actions).map(([key, value]) => {
    const scope = scopes[key as keyof T];
    if (typeof value !== 'function') return [key, value];
    return [key, (...args: unknown[]) => {
      const current = latest.current;
      const invoke = () => (latest.current.actions[key as keyof T] as (...args: unknown[]) => unknown)(...args);
      if (!scope || current.readiness.isReady(scope)) return invoke();
      const owner = current.readiness.ownerKey?.();
      void current.readiness.ensure(scope).then(() => {
        if (!mounted.current) return;
        if (scope !== 'all' && owner !== latest.current.readiness.ownerKey?.()) return;
        invoke();
      }).catch(error => latest.current.readiness.onError(error));
    }];
  })) as T, []);
};
