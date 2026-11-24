import { useSyncExternalStore } from 'react';

/**
 * The site's two faces: 玩錯的桌遊規則 (wrong) and 不確定的桌遊規則 (uncertain).
 * The mode is a per-device preference and never part of the URL; a URL that names
 * one specific item will decide its own mode once uncertain items get their own links.
 */
export type SiteMode = 'wrong' | 'uncertain';

export const SITE_MODE_STORAGE_KEY = 'site_mode';
const SITE_MODE_EVENT = 'site-mode-change';
/** Asks the uncertain view on the current game page to open its editor for a new question. */
export const UNCERTAIN_RULE_ADD_EVENT = 'uncertain-rule-add';

export const SITE_TITLES: Record<SiteMode, string> = { wrong: '玩錯的桌遊規則', uncertain: '不確定的桌遊規則' };
export const SITE_MARKS: Record<SiteMode, string> = { wrong: '✓', uncertain: '?' };

export const readSiteMode = (): SiteMode => {
  try { return localStorage.getItem(SITE_MODE_STORAGE_KEY) === 'uncertain' ? 'uncertain' : 'wrong'; } catch { return 'wrong'; }
};

export const writeSiteMode = (mode: SiteMode) => {
  try { localStorage.setItem(SITE_MODE_STORAGE_KEY, mode); } catch { /* storage may be unavailable; the switch still applies until reload */ }
  memoryMode = mode;
  window.dispatchEvent(new Event(SITE_MODE_EVENT));
};

// Holds this page view's switch so it still applies when storage is blocked; another tab's change clears it.
let memoryMode: SiteMode | undefined;
const snapshot = () => memoryMode ?? readSiteMode();

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SITE_MODE_STORAGE_KEY) return;
    memoryMode = undefined;
    onChange();
  };
  window.addEventListener(SITE_MODE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SITE_MODE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
};

/** The stored mode; callers gate it by who may use the uncertain side. */
export const useStoredSiteMode = () => useSyncExternalStore(subscribe, snapshot, () => 'wrong' as SiteMode);

export const requestUncertainRuleAdd = () => window.dispatchEvent(new Event(UNCERTAIN_RULE_ADD_EVENT));
