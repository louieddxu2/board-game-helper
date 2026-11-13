import { usePageTitle } from '../hooks/usePageTitle';
import { sitePageTitle } from '../lib/gameSeo';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { loginReturnTo } from '../lib/loginNavigation';
import { FirstLoginNickname } from '../components/FirstLoginNickname';
import { GoogleSignIn } from '../components/GoogleSignIn';

export { googleLoginErrorMessage, googleNameFromCredential } from '../components/GoogleSignIn';

export const LoginPage = () => {
  usePageTitle(sitePageTitle('登入'));
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const returnTo = loginReturnTo(useLocation().search);
  // After a first sign-in, offer the Google name as an optional nickname before continuing.
  const [nicknameStep, setNicknameStep] = useState<{ googleName?: string } | null>(null);
  const continueToReturn = () => navigate(returnTo, { replace: true });
  if (nicknameStep) return <section className="login-page narrow-page">
    <p className="eyebrow">帳號</p>
    <h1>登入完成</h1>
    <FirstLoginNickname googleName={nicknameStep.googleName} onDone={continueToReturn} />
  </section>;
  if (loading) return <section className="login-page narrow-page"><h1>正在確認登入狀態…</h1></section>;
  if (user) return <Navigate to={returnTo} replace />;
  return <section className="login-page narrow-page">
    <p className="eyebrow">帳號</p>
    <h1>登入後可以：</h1>
    <ol className="login-benefits">
      <li>查看遊戲列表。</li>
      <li>收藏遊戲至個人首頁。</li>
      <li>有限度地新增玩錯的規則記錄。</li>
      <li>投票玩錯的規則。</li>
    </ol>
    <GoogleSignIn onSignedIn={(firstLogin, googleName) => { if (firstLogin) setNicknameStep({ googleName }); else continueToReturn(); }} />
  </section>;
};
