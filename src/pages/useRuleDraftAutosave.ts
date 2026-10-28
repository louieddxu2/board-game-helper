import { useCallback, useEffect, useRef, useState } from 'react';
import { localDb, type DraftRecord } from '../lib/localDb';

export const useRuleDraftAutosave = (draft: Omit<DraftRecord, 'id'>, enabled: boolean) => {
  const [status, setStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [savedAt, setSavedAt] = useState<number>();
  const latest = useRef(draft);
  const enabledRef = useRef(enabled);
  const mounted = useRef(true);
  const paused = useRef(false);
  const dirty = useRef(false);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  latest.current = draft;
  enabledRef.current = enabled;

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (!enabledRef.current || paused.current) return false;
    const version = ++revision.current;
    const snapshot = latest.current;
    dirty.current = false;
    setStatus('saving');
    try {
      await localDb.saveDraft(snapshot);
      if (mounted.current && version === revision.current) {
        setStatus('saved');
        setSavedAt(Date.now());
      }
      return true;
    } catch {
      if (version === revision.current) {
        dirty.current = true;
        if (mounted.current) setStatus('error');
      }
      return false;
    }
  }, []);

  useEffect(() => {
    revision.current++;
    clearTimeout(timer.current);
    if (!enabled) return;
    paused.current = false;
    dirty.current = true;
    setStatus('saving');
    timer.current = setTimeout(() => { void saveNow(); }, 250);
    return () => clearTimeout(timer.current);
  }, [draft, enabled, saveNow]);

  useEffect(() => {
    mounted.current = true;
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!enabledRef.current || (!dirty.current && status !== 'saving')) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [status]);

  useEffect(() => () => {
    mounted.current = false;
    clearTimeout(timer.current);
    // A quick route change must not drop edits still inside the debounce window.
    if (enabledRef.current && dirty.current && !paused.current) {
      void localDb.saveDraft(latest.current).catch(() => undefined);
    }
  }, []);

  const clear = useCallback(async () => {
    paused.current = true;
    dirty.current = false;
    revision.current++;
    clearTimeout(timer.current);
    try { await localDb.clearDraft(); }
    catch (error) {
      paused.current = false;
      dirty.current = true;
      if (mounted.current) setStatus('error');
      throw error;
    }
  }, []);

  return { status, savedAt, saveNow, clear };
};
