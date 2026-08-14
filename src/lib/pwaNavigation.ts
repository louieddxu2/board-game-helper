export const PWA_LAST_ROUTE_STORAGE_KEY = 'wrong-board-game-pwa-last-route';

export interface PwaRouteLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

const normalizeRoute = (value: string | null | undefined) => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
};

export const pwaRouteFromLocation = ({ pathname, search = '', hash = '' }: PwaRouteLocation) =>
  `${pathname}${search}${hash}`;

export const isInstalledPwa = () => {
  if (typeof window === 'undefined') return false;
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return displayModeStandalone || iosStandalone;
};

export const readPwaLastRoute = () => {
  if (typeof localStorage === 'undefined') return null;
  try {
    return normalizeRoute(localStorage.getItem(PWA_LAST_ROUTE_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const savePwaLastRoute = (location: PwaRouteLocation) => {
  if (!isInstalledPwa() || typeof localStorage === 'undefined') return;
  const route = normalizeRoute(pwaRouteFromLocation(location));
  if (!route) return;
  try {
    localStorage.setItem(PWA_LAST_ROUTE_STORAGE_KEY, route);
  } catch {
    // A restricted storage context should not prevent navigation.
  }
};

export const pwaRouteToRestore = (currentPathname: string, lastRoute: string | null) => {
  if (currentPathname !== '/') return null;
  if (!lastRoute || lastRoute === '/') return null;
  return normalizeRoute(lastRoute);
};
