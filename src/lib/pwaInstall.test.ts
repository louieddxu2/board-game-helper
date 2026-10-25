// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';

const createMediaQuery = (matches = false) => ({
  matches,
  media: '(display-mode: standalone)',
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

const loadTracker = async (standalone = false) => {
  vi.resetModules();
  const media = createMediaQuery(standalone);
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
  return { tracker: await import('./pwaInstall'), media };
};

const installEvent = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('PWA install tracking', () => {
  test('retains an install event before the UI subscribes and prompts it once', async () => {
    const { tracker } = await loadTracker();
    tracker.startPwaInstallTracking();
    const event = installEvent();
    window.dispatchEvent(event);

    expect(tracker.getPwaInstallState()).toBe('available');
    expect(event.defaultPrevented).toBe(true);
    await expect(tracker.requestPwaInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledExactlyOnceWith();
    expect(tracker.getPwaInstallState()).toBe('installed');
    await expect(tracker.requestPwaInstall()).resolves.toBe('installed');
    expect(event.prompt).toHaveBeenCalledExactlyOnceWith();
  });

  test('returns to manual instructions after dismissal or prompt failure', async () => {
    const { tracker } = await loadTracker();
    tracker.startPwaInstallTracking();
    const dismissed = installEvent('dismissed');
    window.dispatchEvent(dismissed);
    await expect(tracker.requestPwaInstall()).resolves.toBe('dismissed');
    expect(tracker.getPwaInstallState()).toBe('manual');

    const rejected = installEvent();
    rejected.prompt.mockRejectedValueOnce(new Error('browser rejected prompt'));
    window.dispatchEvent(rejected);
    await expect(tracker.requestPwaInstall()).resolves.toBe('manual');
    expect(tracker.getPwaInstallState()).toBe('manual');
  });

  test('marks the app installed from the platform event and starts installed when standalone', async () => {
    const first = await loadTracker();
    first.tracker.startPwaInstallTracking();
    const available = installEvent('dismissed');
    window.dispatchEvent(available);
    window.dispatchEvent(new Event('appinstalled'));
    expect(first.tracker.getPwaInstallState()).toBe('installed');

    const standalone = await loadTracker(true);
    standalone.tracker.startPwaInstallTracking();
    expect(standalone.tracker.getPwaInstallState()).toBe('installed');
    expect(standalone.media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
