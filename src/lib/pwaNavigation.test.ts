import { afterEach, describe, expect, it, vi } from 'vitest';
import { PWA_LAST_ROUTE_STORAGE_KEY, isInstalledPwa, isPwaHomeShortcut, pwaRouteFromLocation, pwaRouteToRestore, readPwaLastRoute, savePwaLastRoute } from './pwaNavigation';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('PWA route memory', () => {
  it('builds a route including query and hash', () => {
    expect(pwaRouteFromLocation({ pathname: '/workspace', search: '?table=1', hash: '#row-2' })).toBe('/workspace?table=1#row-2');
  });

  it('restores the remembered route only from the PWA root launch', () => {
    expect(pwaRouteToRestore('/', '/workspace')).toBe('/workspace');
    expect(pwaRouteToRestore('/workspace', '/add')).toBeNull();
    expect(pwaRouteToRestore('/', '/')).toBeNull();
  });

  it('does not restore the remembered route from the explicit homepage shortcut', () => {
    expect(isPwaHomeShortcut({ pathname: '/', search: '?pwa-entry=home' })).toBe(true);
    expect(pwaRouteToRestore('/', '/workspace', true)).toBeNull();
    expect(pwaRouteToRestore('/', '/workspace', false)).toBe('/workspace');
  });

  it('does not let malformed or external-looking routes enter storage', () => {
    localStorage.setItem(PWA_LAST_ROUTE_STORAGE_KEY, 'https://example.com/other-app');
    expect(readPwaLastRoute()).toBeNull();
    expect(pwaRouteToRestore('/', '//example.com')).toBeNull();
  });

  it('saves routes only while running as an installed PWA', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: query === '(display-mode: standalone)' } as MediaQueryList));
    expect(isInstalledPwa()).toBe(true);
    savePwaLastRoute({ pathname: '/workspace' });
    expect(localStorage.getItem(PWA_LAST_ROUTE_STORAGE_KEY)).toBe('/workspace');
  });
});
