import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { ApiError } from '../lib/api';

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(options: { client_id: string; callback(response: { credential: string }): void; auto_select?: boolean; use_fedcm_for_prompt?: boolean }): void;
      renderButton(element: HTMLElement, options: Record<string, unknown>): void;
      prompt(): void;
      disableAutoSelect(): void;
    } } };
  }
}

export const googleLoginErrorMessage = (caught: unknown) => {
  if (!(caught instanceof ApiError)) return 'Google 登入失敗，請再試一次。';
  if (caught.code === 'google_identity_conflict') return '這個 Google 信箱已連結到另一個 Google 身分，請聯絡網站管理者處理。';
  if (caught.code === 'invalid_google_identity') return 'Google 沒有回傳可驗證的信箱身分，請改用已驗證信箱的帳戶。';
  if (caught.code === 'google_auth_not_configured') return '網站的 Google 登入目前尚未正確設定。';
  if (caught.code === 'forbidden_origin') return '目前網址未獲准使用 Google 登入。';
  return 'Google 登入服務暫時發生錯誤，請稍後再試。';
};

// Reads the name from Google's ID token in the browser, only to suggest it as a nickname; the server never keeps it.
export const googleNameFromCredential = (credential: string): string | undefined => {
  try {
    const payload = credential.split('.')[1].replace(/-/gu, '+').replace(/_/gu, '/');
    const bytes = Uint8Array.from(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')), (character) => character.charCodeAt(0));
    const name: unknown = JSON.parse(new TextDecoder().decode(bytes)).name;
    return typeof name === 'string' ? name.normalize('NFKC').replace(/\s+/gu, '') || undefined : undefined;
  } catch {
    return undefined;
  }
};

interface GoogleSignInProps {
  /** Called once the session is set; googleName is only read for a newly created account. */
  onSignedIn(firstLogin: boolean, googleName?: string): void;
}

// The Google button (plus local dev login), so any page that needs an account can sign the visitor in where they are.
export const GoogleSignIn = ({ onSignedIn }: GoogleSignInProps) => {
  const { user, loading, googleClientId, localDevLogin, devLogin, googleLogin } = useSession();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  useEffect(() => {
    if (loading || user || !googleClientId || !buttonRef.current) return;
    const setup = () => {
      const google = window.google;
      const target = buttonRef.current;
      if (!google || !target) return;
      try {
        google.accounts.id.initialize({
          client_id: googleClientId,
          use_fedcm_for_prompt: false,
          auto_select: false,
          callback: (response) => {
            setError('');
            void googleLogin(response.credential)
              .then((firstLogin) => onSignedInRef.current(firstLogin, firstLogin ? googleNameFromCredential(response.credential) : undefined))
              .catch((caught) => setError(googleLoginErrorMessage(caught)));
          },
        });
        google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh_TW' });
      } catch {
        /* ignore Google SDK prompt error on mobile safari */
      }
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      if (window.google) setup(); else existing.addEventListener('load', setup, { once: true });
      return () => existing.removeEventListener('load', setup);
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.googleIdentity = 'true'; script.addEventListener('load', setup, { once: true });
    document.head.append(script);
    return () => script.removeEventListener('load', setup);
  }, [googleClientId, googleLogin, loading, user]);
  return <>
    <div className="login-action-container">
      <div ref={buttonRef} className="google-button" />
      <p className="login-disclaimer">Google 登入只用來識別身分，詳見<Link to="/privacy">隱私與資料說明</Link>。</p>
    </div>
    {!googleClientId && !localDevLogin && <p className="muted">Google 登入尚未設定。</p>}
    {localDevLogin && <button type="button" className="button primary" onClick={() => { setError(''); void devLogin().then(() => onSignedInRef.current(false)).catch(() => setError('本機登入失敗，請確認 migrations 已套用。')); }}>以本機管理員登入</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
};
