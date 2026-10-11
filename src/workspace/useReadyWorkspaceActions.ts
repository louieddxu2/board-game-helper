import { useLayoutEffect, useMemo, useRef } from 'react';

export type WorkspaceReadScope = 'active' | 'all' | 'history' | { tableId: string; requestKey?: object };
type WorkspaceActionScopes<T> = Partial<Record<keyof T, WorkspaceReadScope | (() => WorkspaceReadScope | undefined)>>;
const resolveScope = (scope: WorkspaceReadScope | (() => WorkspaceReadScope | undefined) | undefined): WorkspaceReadScope | undefined => typeof scope === 'function' ? scope() : scope;
const sameScope = (left: WorkspaceReadScope | undefined, right: WorkspaceReadScope | undefined) =>
  typeof left === 'object' && typeof right === 'object' ? left.tableId === right.tableId && left.requestKey === right.requestKey : left === right;
export interface WorkspaceReadiness {
  isReady(scope: WorkspaceReadScope): boolean;
  ensure(scope: WorkspaceReadScope): Promise<void>;
  onError(error: unknown): void;
  ownerKey?(): string | undefined;
}

/** Resume against the latest render, so an operation cannot capture an incomplete table. */
export const useReadyWorkspaceActions = <T extends object>(actions: T, scopes: WorkspaceActionScopes<T>, readiness: WorkspaceReadiness): T => {
  const latest = useRef({ actions, scopes, readiness });
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { latest.current = { actions, scopes, readiness }; });
  return useMemo(() => Object.fromEntries(Object.entries(actions).map(([key, value]) => {
    if (typeof value !== 'function') return [key, value];
    return [key, (...args: unknown[]) => {
      const current = latest.current;
      const configuredScope = current.scopes[key as keyof T];
      const scope = resolveScope(configuredScope);
      const invoke = () => (latest.current.actions[key as keyof T] as (...args: unknown[]) => unknown)(...args);
      if (!scope || current.readiness.isReady(scope)) return invoke();
      const owner = current.readiness.ownerKey?.();
      return current.readiness.ensure(scope).then(() => {
        if (!mounted.current) return;
        if (scope !== 'all' && owner !== latest.current.readiness.ownerKey?.()) return;
        if (!sameScope(scope, resolveScope(latest.current.scopes[key as keyof T]))) return;
        return invoke();
      }).catch(error => latest.current.readiness.onError(error));
    }];
  })) as T, []);
};
