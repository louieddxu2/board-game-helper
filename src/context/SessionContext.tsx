import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { SessionUser } from '../shared/types';
import { clearSearchCache } from '../components/GameSearch';

export type MockRole = 'unauthenticated' | 'user' | 'editor' | 'admin' | null;

interface SessionState {
  user: SessionUser | null;
  realUser: SessionUser | null;
  loading: boolean;
  googleClientId: string | null;
  localDevLogin: boolean;
  refresh(): Promise<void>;
  devLogin(): Promise<void>;
  googleLogin(credential: string): Promise<void>;
  logout(): Promise<void>;
  canEdit: boolean;
  isAdmin: boolean;
  realIsAdmin: boolean;
  mockRole: MockRole;
  setMockRole(role: MockRole): void;
}

export const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider = ({ children }: PropsWithChildren) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [localDevLogin, setLocalDevLogin] = useState(false);
  const [mockRole, setMockRoleState] = useState<MockRole>(() => {
    try {
      const saved = sessionStorage.getItem('mock_role_override');
      return (saved as MockRole) ?? null;
    } catch { return null; }
  });

  const setMockRole = useCallback((role: MockRole) => {
    setMockRoleState(role);
    try {
      if (role) sessionStorage.setItem('mock_role_override', role);
      else sessionStorage.removeItem('mock_role_override');
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.session();
      setUser(response.user);
      setGoogleClientId(response.googleClientId);
      setLocalDevLogin(response.localDevLogin);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!user?.roles.some((role) => role === 'admin' || role === 'editor')) return;
    void localDb.getPending().then(async (pendingItems) => {
      for (const item of pendingItems) {
        try {
          await api.submit(item.payload);
          await localDb.removePending(item.id);
          const draft = await localDb.getDraft();
          const sameDraft = draft?.game?.id === item.payload.gameId
            && draft.rules.filter((rule) => rule.statement.trim()).map((rule) => rule.statement.trim()).join('\n')
              === item.payload.rules.map((rule) => rule.statement.trim()).join('\n');
          if (sameDraft) await localDb.clearDraft();
          await localDb.clearCache();
          clearSearchCache();
        } catch { /* the queue remains available for the next online session */ }
      }
    });
  }, [user]);

  const realIsAdmin = Boolean(user?.roles.includes('admin'));
  const activeMockRole = realIsAdmin ? mockRole : null;

  const effectiveUser = useMemo<SessionUser | null>(() => {
    if (!activeMockRole) return user;
    if (activeMockRole === 'unauthenticated') return null;
    if (activeMockRole === 'user') return { id: user?.id || 'mock_user', email: user?.email || 'user@example.com', roles: [] };
    if (activeMockRole === 'editor') return { id: user?.id || 'mock_editor', email: user?.email || 'editor@example.com', roles: ['editor'] };
    if (activeMockRole === 'admin') return { id: user?.id || 'mock_admin', email: user?.email || 'admin@example.com', roles: ['admin'] };
    return user;
  }, [user, activeMockRole]);

  const canEdit = Boolean(effectiveUser?.roles.some((role) => role === 'admin' || role === 'editor'));
  const isAdmin = Boolean(effectiveUser?.roles.includes('admin'));

  const value = useMemo<SessionState>(() => ({
    user: effectiveUser,
    realUser: user,
    loading,
    googleClientId,
    localDevLogin,
    refresh,
    canEdit,
    isAdmin,
    realIsAdmin,
    mockRole: activeMockRole,
    setMockRole,
    devLogin: async () => { const response = await api.devLogin(); setUser(response.user); },
    googleLogin: async (credential) => { const response = await api.googleLogin(credential); setUser(response.user); },
    logout: async () => { setMockRole(null); await api.logout(); setUser(null); },
  }), [effectiveUser, user, loading, googleClientId, localDevLogin, refresh, canEdit, isAdmin, realIsAdmin, activeMockRole, setMockRole]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is missing');
  return context;
};
