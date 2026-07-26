import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import type { AccountPayload, AccountRevisionSummary, AccountRuleSummary, AccountViewedRuleSummary } from '../shared/types';

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

const ViewedRuleItem = ({ rule }: { rule: AccountViewedRuleSummary }) => (
  <li className="account-item">
    <RuleLink gameSlug={rule.gameSlug} ruleId={rule.ruleId} gameName={rule.gameName} statement={rule.statement} />
    <small>最近看過：{formatDate(rule.viewedAt)}・記錄 {rule.viewCount} 次</small>
  </li>
);

export const AccountPage = () => {
  const navigate = useNavigate();
  const { user, loading, logout } = useSession();
  const [account, setAccount] = useState<AccountPayload>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      setAccount(undefined);
      return;
    }
    let active = true;
    setError('');
    void api.account().then((data) => {
      if (active) setAccount(data);
    }).catch(() => {
      if (active) setError('帳號資料暫時無法載入，請稍後再試。');
    });
    return () => { active = false; };
  }, [user]);

  if (loading) return <section className="account-page narrow-page">
    <p className="eyebrow">帳號</p>
    <h1>正在確認登入狀態…</h1>
  </section>;

  if (!user) return <section className="account-page narrow-page">
    <header>
      <p className="eyebrow">帳號</p>
      <h1>登入後管理你的規則足跡</h1>
      <p className="muted">登入後可以查看你建立的規則、其他編輯者對你規則的修改，以及你看過的規則。</p>
    </header>
    <Link className="button primary" to="/login">登入帳號</Link>
  </section>;

  return <section className="account-page narrow-page">
    <header className="account-header">
      <div>
        <p className="eyebrow">帳號</p>
        <h1>{user?.displayName || '我的帳號'}</h1>
        <p className="muted">{user?.email}</p>
      </div>
      <button type="button" className="button secondary" onClick={() => void logout().then(() => navigate('/'))}>登出</button>
    </header>

    {error && <p className="form-error" role="alert">{error}</p>}
    {!account && !error && <p className="muted">正在載入帳號資料…</p>}
    {account && <div className="account-sections">
      <section className="account-card">
        <div className="account-section-heading"><h2>我建立的規則</h2><span>{account.createdRules.length} 筆</span></div>
        {account.createdRules.length > 0 ? <ul className="account-list">{account.createdRules.map((rule) => <CreatedRuleItem key={rule.id} rule={rule} />)}</ul> : <p className="muted">目前還沒有建立規則。</p>}
      </section>

      <section className="account-card">
        <div className="account-section-heading"><h2>我的規則修改紀錄</h2><span>{account.modifiedRules.length} 筆</span></div>
        <p className="account-help">這裡只顯示其他編輯者修改你建立的規則；你自己修改的內容不會列在這裡。</p>
        {account.modifiedRules.length > 0 ? <ul className="account-list">{account.modifiedRules.map((revision) => <ModifiedRuleItem key={revision.id} revision={revision} />)}</ul> : <p className="muted">目前沒有其他編輯者修改你規則的紀錄。</p>}
      </section>

      <section className="account-card">
        <div className="account-section-heading"><h2>我看過的規則</h2><span>{account.viewedRules.length} 筆</span></div>
        <p className="account-help">目前以點開規則詳細內容作為「看過」的紀錄。</p>
        {account.viewedRules.length > 0 ? <ul className="account-list">{account.viewedRules.map((rule) => <ViewedRuleItem key={rule.ruleId} rule={rule} />)}</ul> : <p className="muted">目前還沒有規則閱讀紀錄。</p>}
      </section>
    </div>}
  </section>;
};
