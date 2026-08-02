import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
    if (user || !googleClientId || !buttonRef.current) return;
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
            void googleLogin(response.credential).then(() => navigate('/account')).catch(() => setError('Google 登入失敗，請再試一次。'));
          },
        });
        google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh_TW' });
      } catch {
        /* ignore Google SDK prompt error on mobile safari */
      }
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) { if (window.google) setup(); else existing.addEventListener('load', setup, { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.googleIdentity = 'true'; script.addEventListener('load', setup, { once: true });
    document.head.append(script);
  }, [googleClientId, googleLogin, navigate]);
  return <section className="login-page narrow-page">
    <p className="eyebrow">帳號</p>
    <h1>登入後可以：</h1>
    <ol className="login-benefits">
      <li>查看遊戲列表。</li>
      <li>收藏遊戲至個人首頁。</li>
      <li>有限度地新增玩錯的規則記錄。</li>
      <li>投票玩錯的規則。</li>
    </ol>
    <div className="login-action-container">
      <div ref={buttonRef} className="google-button" />
      <p className="login-disclaimer">Google 登入僅用來識別身分，本站不會要求存取 Drive、Gmail 等其他權限。登入前請先閱讀本站的 <Link to="/privacy">隱私與資料說明</Link>。</p>
    </div>
    {!googleClientId && !localDevLogin && <p className="muted">Google 登入尚未設定。</p>}
    {localDevLogin && <button type="button" className="button primary" onClick={() => void devLogin().then(() => navigate('/account')).catch(() => setError('本機登入失敗，請確認 migrations 已套用。'))}>以本機管理員登入</button>}
    {error && <p className="form-error">{error}</p>}
  </section>;
};
