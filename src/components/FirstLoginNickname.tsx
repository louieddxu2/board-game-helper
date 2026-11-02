import { Link } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { NICKNAME_RULES, NicknameForm } from './NicknameForm';

// Shown once after an account is created: the Google name is only a suggestion, and 匿名 continues without one.
export const FirstLoginNickname = ({ googleName, onDone }: { googleName?: string; onDone(): void }) => {
  const { user } = useSession();
  return <>
    <p>{googleName && !user?.nickname ? `要用 Google 名稱「${googleName}」當暱稱嗎？` : '要設定暱稱嗎？'}</p>
    <p className="muted">{NICKNAME_RULES}之後可在 <Link to="/account">帳號頁</Link> 修改。</p>
    <NicknameForm submitLabel="儲存並繼續" anonymousLabel="以匿名繼續" initialNickname={googleName} onSaved={onDone} />
  </>;
};
