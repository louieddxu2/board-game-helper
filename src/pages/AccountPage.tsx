import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { ApiError, api } from '../lib/api';
import type { AccountPayload, AccountRevisionSummary, AccountRuleSummary } from '../shared/types';
import { useConfirm } from '../context/ConfirmContext';
import { writeHomeMode } from '../lib/homeMode';

const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString('zh-TW', {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

const statusLabel: Record<AccountRuleSummary['status'], string> = {
  published: '已發布',
  hidden: '已隱藏',
  draft: '草稿',
};

const RuleLink = ({ gameSlug, ruleId, gameName, statement }: { gameSlug: string; ruleId: string; gameName: string; statement: string }) => (
  <Link className="account-item-link" to={`/games/${gameSlug}#rule-${ruleId}`}>
    <strong>{gameName}</strong>
    <span>{statement}</span>
  </Link>
);

const CreatedRuleItem = ({ rule }: { rule: AccountRuleSummary }) => (
  <li className="account-item">
    <RuleLink gameSlug={rule.gameSlug} ruleId={rule.id} gameName={rule.gameName} statement={rule.statement} />
    <small>{statusLabel[rule.status]}・建立於 {formatDate(rule.createdAt)}</small>
  </li>
);

const ModifiedRuleItem = ({ revision }: { revision: AccountRevisionSummary }) => (
  <li className="account-item">
    <RuleLink gameSlug={revision.gameSlug} ruleId={revision.ruleId} gameName={revision.gameName} statement={revision.currentStatement} />
    <small>{revision.editedByName ? `由 ${revision.editedByName} ` : '由其他編輯者 '}修改於 {formatDate(revision.editedAt)}・{revision.reason}</small>
    {revision.previousStatement && <div className="account-change"><span>修改前：{revision.previousStatement}</span><span>現在：{revision.currentStatement}</span></div>}
  </li>
);

export const AccountPage = () => {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const { user, loading, logout, canEdit, refresh } = useSession();
  const [account, setAccount] = useState<AccountPayload>();
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState('');
  const [showNickname, setShowNickname] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState('');
  const [nicknameSaved, setNicknameSaved] = useState(false);
  const [favoritesClearing, setFavoritesClearing] = useState(false);
  const [favoritesCleared, setFavoritesCleared] = useState(false);

  useEffect(() => {
    if (!user) {
      setAccount(undefined);
      return;
    }
    let active = true;
    setError('');
    void api.account().then((data) => {
      if (active) {
        setAccount(data);
        setNickname(data.user.nickname ?? '');
        setShowNickname(Boolean(data.user.showNickname));
      }
    }).catch(() => {
      if (active) setError('帳號資料暫時無法載入，請稍後再試。');
    });
    return () => { active = false; };
  }, [user]);

  const saveNickname = async () => {
    if (!canEdit || nicknameSaving) return;
    setNicknameSaving(true);
    setNicknameError('');
    setNicknameSaved(false);
    try {
      const response = await api.updateNickname(nickname, showNickname);
      setAccount((current) => current ? { ...current, user: response.user } : current);
      setNickname(response.user.nickname ?? '');
      setShowNickname(Boolean(response.user.showNickname));
      await refresh();
      setNicknameSaved(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'nickname_taken') setNicknameError('這個暱稱已被使用。');
      else if (caught instanceof ApiError && caught.code === 'invalid_nickname') setNicknameError('暱稱只能使用中文字或英文字母，中文字最多 6 個、英文字母最多 12 個。');
      else setNicknameError('暱稱暫時無法儲存，請稍後再試。');
    } finally {
      setNicknameSaving(false);
    }
  };

  const clearFavorites = async () => {
    const confirmed = await confirm({
      title: '清除所有收藏？',
      message: '所有裝置上的遊戲收藏與已讀狀態都會刪除。',
      confirmLabel: '清除收藏',
      tone: 'danger',
    });
    if (!confirmed) return;
    setFavoritesClearing(true);
    setFavoritesCleared(false);
    try {
      await api.clearFavorites();
      writeHomeMode('explore');
      setFavoritesCleared(true);
    } catch { setError('收藏暫時無法清除，請稍後再試。'); }
    finally { setFavoritesClearing(false); }
  };

  if (loading) return <section className="account-page narrow-page">
    <p className="eyebrow">帳號</p>
    <h1>正在確認登入狀態…</h1>
  </section>;

  if (!user) return <section className="account-page narrow-page">
    <header>
      <p className="eyebrow">帳號</p>
      <h1>登入後管理你的規則足跡</h1>
      <p className="muted">登入後可以查看你建立的規則與其他編輯者對你規則的修改。</p>
    </header>
    <Link className="button primary" to="/login">登入帳號</Link>
  </section>;

  return <section className="account-page narrow-page">
    <header className="account-header">
      <div>
        <p className="eyebrow">帳號</p>
        <h1>{user?.nickname || user?.displayName || '我的帳號'}</h1>
        <p className="muted">{user?.email}</p>
      </div>
      <button type="button" className="button secondary" onClick={() => void logout().then(() => navigate('/'))}>登出</button>
    </header>

    {error && <p className="form-error" role="alert">{error}</p>}
    {canEdit && <section className="account-card account-settings">
      <div className="account-section-heading"><h2>帳號設定</h2></div>
      <p className="account-help">設定一個會顯示在你的帳號活動中的暱稱。限中文字或英文字母，中文字最多 6 個、英文字母最多 12 個，且不可與他人重複。</p>
      <form onSubmit={(event) => { event.preventDefault(); void saveNickname(); }}>
        <label htmlFor="account-nickname">暱稱<input id="account-nickname" value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} placeholder="輸入暱稱" /></label>
        <label className="checkbox-row" htmlFor="account-show-nickname">
          <input id="account-show-nickname" type="checkbox" checked={showNickname} disabled={!nickname.trim()} onChange={(event) => setShowNickname(event.target.checked)} />
          顯示暱稱（規則卡片會顯示你建立或修改過）
        </label>
        {nicknameError && <p className="form-error" role="alert">{nicknameError}</p>}
        {nicknameSaved && <p className="form-success" role="status">暱稱已更新。</p>}
        <button className="button primary" type="submit" disabled={!nickname.trim() || nicknameSaving}>{nicknameSaving ? '儲存中…' : '儲存暱稱'}</button>
      </form>
    </section>}
    <section className="account-card account-settings">
      <div className="account-section-heading"><h2>收藏資料</h2></div>
      <p className="account-help">收藏的遊戲與已讀版本會跟著帳號同步。最近查看與首頁顯示模式只保存在目前裝置。</p>
      {favoritesCleared && <p className="form-success" role="status">所有收藏已清除。</p>}
      <button type="button" className="button secondary" disabled={favoritesClearing} onClick={() => void clearFavorites()}>{favoritesClearing ? '清除中…' : '清除所有收藏'}</button>
    </section>
    {!account && !error && <p className="muted">正在載入帳號資料…</p>}
    {canEdit && account && <div className="account-sections">
      <section className="account-card">
        <div className="account-section-heading"><h2>我建立的規則</h2><span>{account.createdRules.length} 筆</span></div>
        {account.createdRules.length > 0 ? <ul className="account-list">{account.createdRules.map((rule) => <CreatedRuleItem key={rule.id} rule={rule} />)}</ul> : <p className="muted">目前還沒有建立規則。</p>}
      </section>

      <section className="account-card">
        <div className="account-section-heading"><h2>我的規則修改紀錄</h2><span>{account.modifiedRules.length} 筆</span></div>
        <p className="account-help">這裡只顯示其他編輯者修改你建立的規則；你自己修改的內容不會列在這裡。</p>
        {account.modifiedRules.length > 0 ? <ul className="account-list">{account.modifiedRules.map((revision) => <ModifiedRuleItem key={revision.id} revision={revision} />)}</ul> : <p className="muted">目前沒有其他編輯者修改你規則的紀錄。</p>}
      </section>
    </div>}
  </section>;
};
