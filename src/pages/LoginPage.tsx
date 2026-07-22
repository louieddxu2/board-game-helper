import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

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

export const LoginPage = () => {
  const { user, googleClientId, localDevLogin, devLogin, googleLogin } = useSession();
  const buttonRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!googleClientId || !buttonRef.current) return;
    const setup = () => {
      if (!window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        use_fedcm_for_prompt: true,
        auto_select: true,
        callback: (response) => {
          void googleLogin(response.credential).then(() => navigate('/add')).catch(() => setError('Google 登入失敗，請再試一次。'));
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh_TW' });
      window.google.accounts.id.prompt();
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) { if (window.google) setup(); else existing.addEventListener('load', setup, { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.googleIdentity = 'true'; script.addEventListener('load', setup, { once: true });
    document.head.append(script);
  }, [googleClientId, googleLogin, navigate]);
  if (user) return <Navigate to="/add" replace />;
  return <section className="login-page narrow-page">
    <p className="eyebrow">編輯者登入</p><h1>公開閱讀，授權編輯</h1>
    <p>Google只用來確認你是哪個帳號；本站不要求存取 Drive、試算表、Gmail 或其他 Google 資料。</p>
    <div ref={buttonRef} className="google-button" />
    {!googleClientId && !localDevLogin && <p className="muted">Google 登入尚未設定。</p>}
    {localDevLogin && <button type="button" className="button primary" onClick={() => void devLogin().then(() => navigate('/add')).catch(() => setError('本機登入失敗，請確認 migrations 已套用。'))}>以本機管理員登入</button>}
    {error && <p className="form-error">{error}</p>}
  </section>;
};

