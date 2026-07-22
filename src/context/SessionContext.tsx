import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { SessionUser } from '../shared/types';

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  googleClientId: string | null;
  localDevLogin: boolean;
  refresh(): Promise<void>;
  devLogin(): Promise<void>;
  googleLogin(credential: string): Promise<void>;
  logout(): Promise<void>;
  canEdit: boolean;
  isAdmin: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider = ({ children }: PropsWithChildren) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [localDevLogin, setLocalDevLogin] = useState(false);
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
        } catch { /* the queue remains available for the next online session */ }
      }
    });
  }, [user]);
  const value = useMemo<SessionState>(() => ({
    user,
    loading,
    googleClientId,
    localDevLogin,
    refresh,
    canEdit: Boolean(user?.roles.some((role) => role === 'admin' || role === 'editor')),
    isAdmin: Boolean(user?.roles.includes('admin')),
    devLogin: async () => { const response = await api.devLogin(); setUser(response.user); },
    googleLogin: async (credential) => { const response = await api.googleLogin(credential); setUser(response.user); },
    logout: async () => { await api.logout(); setUser(null); },
  }), [user, loading, googleClientId, localDevLogin, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is missing');
  return context;
};
