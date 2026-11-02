import { useEffect, useState } from 'react';
import { useSession } from '../context/SessionContext';
import { ApiError, api } from '../lib/api';
import { localDb } from '../lib/localDb';

export const NICKNAME_RULES = '限中文字或英文字母，中文字最多 6 個、英文字母最多 12 個，且不可與他人重複。';

interface NicknameFormProps {
  submitLabel: string;
  /** Suggested value shown while the account has no nickname yet. */
  initialNickname?: string;
  onSaved?: () => void;
  /** Offers an 匿名 button that clears the field; submitting an empty field then continues without saving. */
  anonymousLabel?: string;
}

export const NicknameForm = ({ submitLabel, initialNickname, onSaved, anonymousLabel }: NicknameFormProps) => {
  const { user, refresh } = useSession();
  const [nickname, setNickname] = useState('');
  const [showNickname, setShowNickname] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNickname(user?.nickname ?? initialNickname ?? '');
    setShowNickname(Boolean(user?.showNickname));
  }, [initialNickname, user?.nickname, user?.showNickname]);

  const anonymous = Boolean(anonymousLabel) && !nickname.trim();

  const save = async () => {
    if (saving) return;
    if (anonymous) { onSaved?.(); return; }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const response = await api.updateNickname(nickname, showNickname);
      setNickname(response.user.nickname ?? '');
      setShowNickname(Boolean(response.user.showNickname));
      await Promise.all([refresh(), localDb.invalidateHome(), localDb.invalidateAllGames()]);
      setSaved(true);
      onSaved?.();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'nickname_taken') setError('這個暱稱已被使用。');
      else if (caught instanceof ApiError && caught.code === 'invalid_nickname') setError(`暱稱${NICKNAME_RULES.replace('，且不可與他人重複。', '。')}`);
      else setError('暱稱暫時無法儲存，請稍後再試。');
    } finally {
      setSaving(false);
    }
  };

  return <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label htmlFor="account-nickname">暱稱<input id="account-nickname" value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} placeholder="輸入暱稱" /></label>
    <label className="checkbox-row" htmlFor="account-show-nickname">
      <input id="account-show-nickname" type="checkbox" checked={showNickname} disabled={!nickname.trim()} onChange={(event) => setShowNickname(event.target.checked)} />
      公開顯示暱稱（規則卡片會標示你建立、修改或審核過）
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && !onSaved && <p className="form-success" role="status">暱稱已更新。</p>}
    <div className="nickname-actions">
      <button className="button primary" type="submit" disabled={(!nickname.trim() && !anonymous) || saving}>{saving ? '儲存中…' : anonymous ? anonymousLabel : submitLabel}</button>
      {anonymousLabel && <button type="button" className="button secondary" disabled={!nickname || saving} onClick={() => { setNickname(''); setShowNickname(false); setError(''); }}>匿名</button>}
    </div>
  </form>;
};
