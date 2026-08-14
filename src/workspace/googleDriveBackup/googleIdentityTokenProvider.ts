import type {
  AccessTokenProvider,
  GoogleIdentityDocument,
  GoogleIdentityScript,
  GoogleIdentityTokenProviderOptions,
  GoogleIdentityWindow,
  GoogleTokenClient,
  GoogleTokenResponse,
} from './types';

const DEFAULT_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DEFAULT_SCRIPT_ID = 'google-identity-services';
const DEFAULT_SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DEFAULT_SCRIPT_TIMEOUT_MS = 10_000;

const defaultWindow = (): GoogleIdentityWindow => {
  if (typeof window === 'undefined') throw new Error('Google Identity Services 需要瀏覽器視窗');
  return window as unknown as GoogleIdentityWindow;
};

const defaultDocument = (): GoogleIdentityDocument => {
  if (typeof document === 'undefined') throw new Error('Google Identity Services 需要瀏覽器文件');
  return document as unknown as GoogleIdentityDocument;
};

const getOAuth = (windowRef: GoogleIdentityWindow) => {
  const oauth = windowRef.google?.accounts?.oauth2;
  if (!oauth) throw new Error('Google Identity Services 尚未準備完成');
  return oauth;
};

const loadIdentityScript = (
  documentRef: GoogleIdentityDocument,
  windowRef: GoogleIdentityWindow,
  options: Required<Pick<GoogleIdentityTokenProviderOptions, 'scriptUrl' | 'scriptId' | 'scriptTimeoutMs'>>,
): Promise<void> => {
  if (windowRef.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = documentRef.getElementById(options.scriptId);
    const script: GoogleIdentityScript = existing ?? documentRef.createElement('script');
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('載入 Google Identity Services 逾時'));
    }, options.scriptTimeoutMs);
    const complete = () => {
      if (settled) return;
      if (!windowRef.google?.accounts?.oauth2) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error('Google Identity Services 缺少 oauth2 支援'));
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };
    script.onload = complete;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error('Google Identity Services 載入失敗'));
    };
    if (!existing) {
      script.id = options.scriptId;
      script.src = options.scriptUrl;
      script.async = true;
      script.defer = true;
      documentRef.body.appendChild(script);
    }
  });
};

export interface GoogleIdentityTokenProvider extends AccessTokenProvider {
  readonly isAuthorized: boolean;
  signIn(options?: { prompt?: string }): Promise<string>;
  signOut(): Promise<void>;
}

/** Access tokens stay in memory and are never written to localStorage or IndexedDB. */
export const createGoogleIdentityTokenProvider = (input: GoogleIdentityTokenProviderOptions): GoogleIdentityTokenProvider => {
  const windowRef = input.windowRef ?? defaultWindow();
  const documentRef = input.documentRef ?? defaultDocument();
  const scriptOptions = {
    scriptUrl: input.scriptUrl ?? DEFAULT_SCRIPT_URL,
    scriptId: input.scriptId ?? DEFAULT_SCRIPT_ID,
    scriptTimeoutMs: input.scriptTimeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
  };
  const scopes = input.scopes ?? DEFAULT_SCOPES;
  let token: string | null = null;
  let expiresAt = 0;
  let tokenClient: GoogleTokenClient | null = null;
  let scriptPromise: Promise<void> | null = null;
  let signInPromise: Promise<string> | null = null;

  const ensureReady = async () => {
    if (!scriptPromise) scriptPromise = loadIdentityScript(documentRef, windowRef, scriptOptions);
    try { await scriptPromise; } catch (error) { scriptPromise = null; throw error; }
    if (!tokenClient) {
      tokenClient = getOAuth(windowRef).initTokenClient({
        client_id: input.clientId.trim(),
        scope: scopes,
        callback: () => undefined,
      });
    }
  };

  const signIn = async ({ prompt = '' }: { prompt?: string } = {}): Promise<string> => {
    if (signInPromise) return signInPromise;
    signInPromise = (async () => {
      await ensureReady();
      if (!tokenClient) throw new Error('Google OAuth token client 初始化失敗');
      return new Promise<string>((resolve, reject) => {
        tokenClient!.callback = (response: GoogleTokenResponse) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error_description ?? response.error ?? 'Google 授權失敗'));
            return;
          }
          token = response.access_token;
          expiresAt = Date.now() + Math.max((response.expires_in ?? 3600) - 60, 1) * 1000;
          resolve(token);
        };
        tokenClient!.requestAccessToken({ prompt });
      });
    })().finally(() => { signInPromise = null; });
    return signInPromise;
  };

  return {
    get isAuthorized() { return Boolean(token && Date.now() < expiresAt); },
    async getAccessToken(options = {}) {
      if (token && Date.now() < expiresAt) return token;
      return signIn(options);
    },
    signIn,
    async signOut() {
      if (token && windowRef.google?.accounts?.oauth2) {
        await new Promise<void>((resolve) => {
          try { getOAuth(windowRef).revoke(token!, resolve); } catch { resolve(); }
        });
      }
      token = null;
      expiresAt = 0;
    },
  };
};
