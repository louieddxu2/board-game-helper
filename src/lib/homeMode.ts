export type HomeMode = 'personal' | 'explore';

export const HOME_MODE_STORAGE_KEY = 'home_view_mode';

export const readHomeMode = (): HomeMode | null => {
  try {
    const value = localStorage.getItem(HOME_MODE_STORAGE_KEY);
    return value === 'personal' || value === 'explore' ? value : null;
  } catch { return null; }
};

export const writeHomeMode = (mode: HomeMode) => {
  try { localStorage.setItem(HOME_MODE_STORAGE_KEY, mode); } catch { /* storage may be unavailable */ }
};

export const resolveHomeMode = (favoriteCount: number, savedMode = readHomeMode()): HomeMode => {
  if (favoriteCount === 0) return 'explore';
  return savedMode ?? 'personal';
};
