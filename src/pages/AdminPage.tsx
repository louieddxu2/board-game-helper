import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { GameSearch, clearSearchCache } from '../components/GameSearch';
import { clearPublicTagCache } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { GameSummary, RuleCard, TagSummary } from '../shared/types';
import { useToast } from '../context/ToastContext';

export const AdminPage = () => {
  const { realIsAdmin, mockRole, setMockRole, loading } = useSession();
  const { showToast } = useToast();
  const [editors, setEditors] = useState<{ users: Array<Record<string, unknown>>; invitations: Array<Record<string, unknown>> }>({ users: [], invitations: [] });
  const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [hiddenRules, setHiddenRules] = useState<RuleCard[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [sourceGame, setSourceGame] = useState<GameSummary>();
  const [targetGame, setTargetGame] = useState<GameSummary>();
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'admin'>('editor');
  const [newTagName, setNewTagName] = useState('');
  const [newTagDesc, setNewTagDesc] = useState('');
  const [tagQuery, setTagQuery] = useState('');

  const load = async () => {
    const [editorData, importData, hiddenData, tagData] = await Promise.all([
      api.editors().catch(() => ({ users: [], invitations: [] })),
      api.importRows().catch(() => ({ rows: [] })),
      api.hiddenRules().catch(() => ({ rules: [] })),
      api.adminTags().catch(() => ({ tags: [] })),
    ]);
    setEditors(editorData);
    setImportRows(importData.rows);
    setHiddenRules(hiddenData.rules);
    setTags(tagData.tags);
  };
  useEffect(() => { if (realIsAdmin) void load(); }, [realIsAdmin]);

  const handleClearLocalData = async () => {
    if (window.confirm('確定要清除本機快取嗎？（不會影響雲端資料庫，也不會刪除草稿或待送出資料）')) {
      await localDb.clearCache();
      localStorage.clear();
      clearSearchCache();
      showToast('本機快取已清除！');
      window.location.reload();
    }
  };

  const handleCreatePublicTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    await api.createAdminTag({ name: newTagName.trim(), description: newTagDesc.trim() || undefined, isPublic: true });
    clearPublicTagCache();
    setNewTagName('');
    setNewTagDesc('');
    showToast('已成功建立公共 Tag！');
    await load();
  };

  const handleTogglePublic = async (tag: TagSummary) => {
    await api.updateAdminTag(tag.id, { isPublic: !tag.isPublic });
    clearPublicTagCache();
    showToast(`已將 #${tag.name} 設定為 ${!tag.isPublic ? '公共 Tag' : '非公共 Tag'}`);
    await load();
  };

  const filteredTags = tags.filter((t) => !tagQuery || t.name.includes(tagQuery) || (t.aliases && t.aliases.some((a) => a.includes(tagQuery))));

  if (!loading && !realIsAdmin) return <Navigate to="/" replace />;
  return <section className="admin-page">
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
      <div>
        <p className="eyebrow">管理與校稿</p>
        <h1>內容工作臺</h1>
        <p>管理編輯者、公共 Tag、舊資料拆分與名稱整理。</p>
      </div>
      <button type="button" className="button secondary" onClick={() => void handleClearLocalData()} style={{ whiteSpace: 'nowrap' }}>
        🧹 清除本機快取
      </button>
    </header>

    <section className="admin-card" style={{ marginBottom: '1.5rem', background: 'var(--surface-elevated, #fafafa)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🎭 身份模擬與 UI 預覽</span>
            {mockRole && <span className="tag-chip active" style={{ fontSize: '0.75rem' }}>模擬中</span>}
          </h2>
          <p className="muted" style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
            切換前台頁面（首頁、遊戲頁等）預覽不同角色的介面視角。導覽列按鈕將標示當前模擬狀態，方便隨時切換。
          </p>
        </div>
        <div className="inline-actions" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={mockRole === null ? 'button primary' : 'button secondary'}
            onClick={() => { setMockRole(null); showToast('已恢復真實 Admin 身份'); }}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            👑 真實身分
          </button>
          <button
            type="button"
            className={mockRole === 'unauthenticated' ? 'button primary' : 'button secondary'}
            onClick={() => { setMockRole('unauthenticated'); showToast('已切換模擬為：未登入 (Guest)'); }}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            👤 未登入
          </button>
          <button
            type="button"
            className={mockRole === 'user' ? 'button primary' : 'button secondary'}
            onClick={() => { setMockRole('user'); showToast('已切換模擬為：一般使用者'); }}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            📱 一般使用者
          </button>
          <button
            type="button"
            className={mockRole === 'editor' ? 'button primary' : 'button secondary'}
            onClick={() => { setMockRole('editor'); showToast('已切換模擬為：Editor'); }}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            ✏️ Editor
          </button>
          <button
            type="button"
            className={mockRole === 'admin' ? 'button primary' : 'button secondary'}
            onClick={() => { setMockRole('admin'); showToast('已切換模擬為：Admin'); }}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            🔑 Admin
          </button>
        </div>
      </div>
    </section>

    <div className="admin-grid">
      <section className="admin-card"><h2>編輯者</h2>
        <p className="muted">所有編輯者與管理員權限皆透過此頁面管理。輸入對方的 Google 信箱即可授予權限，對方首次登入後自動生效。</p>
        <form onSubmit={(event) => { event.preventDefault(); void api.inviteEditor(email, role).then(() => { setEmail(''); showToast('已建立編輯者授權。'); return load(); }); }}>
          <label>Google 信箱<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@gmail.com" /></label>
          <label>角色<select value={role} onChange={(event) => setRole(event.target.value as 'editor' | 'admin')}><option value="editor">Editor</option><option value="admin">Admin</option></select></label>
          <button className="button primary" type="submit">新增／邀請</button>
        </form>
        <div className="admin-list">
          {editors.users.map((row, index) => <div key={`${row.id}-${row.role}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <strong style={{ marginRight: '0.5rem', color: 'var(--text)' }}>{String(row.email)}</strong>
              <small style={{ background: 'var(--accent-dim, #f0f4f8)', padding: '2px 8px', borderRadius: '4px', textTransform: 'capitalize' }}>
                {String(row.role)}{row.revoked_at ? '・已撤銷' : ''}
              </small>
            </span>
            {!row.revoked_at && <button type="button" className="danger-link" onClick={() => { if (window.confirm(`撤銷 ${String(row.email)} 的 ${String(row.role)} 權限？`)) void api.revokeEditor(String(row.id), String(row.role) as 'admin' | 'editor').then(load); }}>撤銷</button>}
          </div>)}
          {editors.invitations.map((row) => <div key={String(row.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <strong style={{ marginRight: '0.5rem', color: 'var(--text)' }}>{String(row.email)}</strong>
              <small style={{ background: 'var(--accent-dim, #f0f4f8)', padding: '2px 8px', borderRadius: '4px', textTransform: 'capitalize' }}>
                {String(row.role)}・{row.revoked_at ? '已撤銷' : '等待首次登入'}
              </small>
            </span>
            {!row.revoked_at && <button type="button" className="danger-link" onClick={() => void api.revokeInvitation(String(row.id)).then(load)}>取消</button>}
          </div>)}
        </div>
      </section>

      <section className="admin-card">
        <div className="list-heading"><h2>公共 Tag 管理</h2><span>{tags.length} 個</span></div>
        <p className="muted">公共 Tag 可供所有遊戲選用。非公共 Tag 為遊戲專屬自訂標籤。</p>
        <form onSubmit={(e) => void handleCreatePublicTag(e)} style={{ marginBottom: '1rem' }}>
          <label>新增公共 Tag 名稱<input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="例如：玩家互動、盲拍" required /></label>
          <label>標籤說明 (可選)<input value={newTagDesc} onChange={(e) => setNewTagDesc(e.target.value)} placeholder="說明此標籤適用的機制或時機" /></label>
          <button type="submit" className="button primary">建立公共 Tag</button>
        </form>
        <label>搜尋 Tag<input type="search" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="搜尋 Tag 名稱…" /></label>
        <div className="admin-list" style={{ maxHeight: '350px', overflowY: 'auto' }}>
          {filteredTags.map((tag) => (
            <div key={tag.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>#{tag.name}</strong>
                {tag.isPublic ? <span className="tag-chip active" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>公共</span> : <span className="tag-chip" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>專屬</span>}
                <small style={{ display: 'block' }}>使用數: {tag.usageCount ?? 0} 條 {tag.description && `・${tag.description}`}</small>
              </div>
              <button type="button" className="text-action" onClick={() => void handleTogglePublic(tag)}>
                {tag.isPublic ? '設為專屬' : '設為公共'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-card import-card"><div className="list-heading"><h2>舊資料待確認</h2><span>{importRows.length} 筆</span></div>
        {importRows.length === 0 && <p className="muted">目前沒有 staged 資料。執行匯入指令後會在這裡出現。</p>}
        {importRows.slice(0, 20).map((row) => <article key={String(row.id)}><strong>{String(row.raw_game_name)}</strong><p>{String(row.raw_rule_text)}</p><small>原始第 {String(row.source_row_number)} 列・宣告 {String(row.declared_rule_count ?? '?')} 條</small>
          <div className="inline-actions"><button type="button" className="text-action" onClick={() => void api.confirmImport(String(row.id)).then(async () => { await localDb.clearCache(); clearSearchCache(); showToast('已確認並匯入這筆舊資料。'); return load(); })}>按建議拆分匯入</button>
            <button type="button" className="danger-link" onClick={() => void api.skipImport(String(row.id)).then(load)}>略過</button></div></article>)}
      </section>

      <section className="admin-card"><h2>合併重複遊戲</h2><p className="muted">來源遊戲的規則與別名會移到目標遊戲，原名稱仍可搜尋。</p>
        <GameSearch value={sourceQuery} selectedId={sourceGame?.id} onChange={(value) => { setSourceQuery(value); if (sourceGame && value !== sourceGame.displayName) setSourceGame(undefined); }} onSelect={(game) => { setSourceGame(game); setSourceQuery(game.displayName); }} />
        <div className="merge-arrow">↓ 合併到</div>
        <GameSearch value={targetQuery} selectedId={targetGame?.id} onChange={(value) => { setTargetQuery(value); if (targetGame && value !== targetGame.displayName) setTargetGame(undefined); }} onSelect={(game) => { setTargetGame(game); setTargetQuery(game.displayName); }} />
        <button type="button" className="button primary full-button" disabled={!sourceGame || !targetGame || sourceGame.id === targetGame.id}
          onClick={() => { if (sourceGame && targetGame && window.confirm(`將「${sourceGame.displayName}」合併到「${targetGame.displayName}」？`)) void api.mergeGame(sourceGame.id, targetGame.id).then(async () => { await localDb.invalidateGame(sourceGame.slug); await localDb.invalidateGame(targetGame.slug); await localDb.invalidateHome(); clearSearchCache(); showToast('遊戲已合併，舊名稱保留為別名。'); setSourceGame(undefined); setTargetGame(undefined); setSourceQuery(''); setTargetQuery(''); }); }}>合併遊戲</button>
      </section>

      <section className="admin-card"><div className="list-heading"><h2>已隱藏規則</h2><span>{hiddenRules.length} 條</span></div>
        <div className="admin-list">{hiddenRules.map((rule) => <div key={rule.id}><strong>{rule.statement}</strong><button type="button" className="text-action" onClick={() => void api.restoreRule(rule.id).then(async () => { await localDb.clearCache(); clearSearchCache(); load(); })}>恢復</button></div>)}</div>
      </section>
    </div>
  </section>;
};
