import { isInstalledPwa } from './pwaNavigation';

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallState = 'manual' | 'available' | 'prompting' | 'installed';
let state: InstallState = 'manual';
let deferredPrompt: InstallPromptEvent | undefined;
let started = false;
const listeners = new Set<() => void>();
const update = (next: InstallState) => {
  if (state === next) return;
  state = next;
  listeners.forEach((listener) => listener());
};

// Start before rendering lazy routes so an early install event is retained.
export function startPwaInstallTracking() {
  if (started) return;
  started = true;
  update(isInstalledPwa() ? 'installed' : 'manual');
  window.addEventListener('beforeinstallprompt', (event) => {
    if (isInstalledPwa() || state === 'installed') return;
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    update('available');
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    update('installed');
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => {
    if (isInstalledPwa()) {
      deferredPrompt = undefined;
      update('installed');
    }
  });
}

export const getPwaInstallState = () => state;
export const subscribePwaInstall = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export async function requestPwaInstall() {
  if (state === 'installed' || state === 'prompting') return state;
  const event = deferredPrompt;
  if (!event) return 'manual';
  deferredPrompt = undefined; // Each browser event can be prompted only once.
  update('prompting');
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (getPwaInstallState() !== 'installed') update(outcome === 'accepted' ? 'installed' : deferredPrompt ? 'available' : 'manual');
    return outcome;
  } catch {
    if (getPwaInstallState() !== 'installed') update(deferredPrompt ? 'available' : 'manual');
    return 'manual';
  }
}

export function pwaInstallInstructions() {
  const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return '請用 Safari 開啟本站，點選「分享」→「加入主畫面」，開啟「以網頁 App 開啟」（若有此選項），再點選「加入」。';
  if (/Android/i.test(navigator.userAgent)) return '開啟瀏覽器選單，選擇「安裝應用程式」或「加入主畫面」，依畫面指示完成。若找不到選項，請用 Chrome 開啟本站再試一次。';
  return '在 Chrome 或 Edge 的網址列或瀏覽器選單中選擇「安裝」或「將網頁安裝為應用程式」。若尚未出現安裝選項，請稍後再試。Mac 的 Safari 可從「檔案」選單選擇「加入 Dock」。';
}
