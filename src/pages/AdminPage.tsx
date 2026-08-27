import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { GameSearch, clearSearchCache } from '../components/GameSearch';
import { AdminTagEditor } from '../components/AdminTagEditor';
import { AdminAttributeExpansionEditor } from '../components/AdminAttributeExpansionEditor';
import { clearPublicTagCache } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { ApiError, api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { AttributeExpansionMetadata, EditorAccessUser, EditorAdminPayload, GameSummary, RuleCard, RuleCategory, TagSummary } from '../shared/types';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export const AdminPage = () => {
  const { realIsAdmin, mockRole, setMockRole, loading } = useSession();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [editors, setEditors] = useState<EditorAdminPayload>({ users: [], invitations: [] });
  const [editorLoadError, setEditorLoadError] = useState<string>();
  const [importRows, setImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [hiddenRules, setHiddenRules] = useState<RuleCard[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [sourceGame, setSourceGame] = useState<GameSummary>();
  const [targetGame, setTargetGame] = useState<GameSummary>();
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [note, setNote] = useState('');
  const [role, setRole] = useState<'editor' | 'admin'>('editor');
  const [newTagName, setNewTagName] = useState('');
  const [newTagDesc, setNewTagDesc] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [sourceTagId, setSourceTagId] = useState('');
  const [targetTagId, setTargetTagId] = useState('');
  const [attributeExpansions, setAttributeExpansions] = useState<AttributeExpansionMetadata[]>([]);
  const [attributeExpansionLoadError, setAttributeExpansionLoadError] = useState(false);
  const [savingAttributeExpansion, setSavingAttributeExpansion] = useState<string>();

  const load = async () => {
    const [, importData, hiddenData, tagData, expansionData] = await Promise.all([
      api.editors().then((editorData) => {
        setEditors(editorData);
        setEditorLoadError(undefined);
      }).catch(() => setEditorLoadError('無法載入編輯權限名單，請重試。')),
      api.importRows().catch(() => ({ rows: [] })),
      api.hiddenRules().catch(() => ({ rules: [] })),
      api.adminTags().catch(() => ({ tags: [] })),
      api.adminAttributeExpansions().catch(() => ({ expansions: [], failed: true })),
    ]);
    setImportRows(importData.rows);
    setHiddenRules(hiddenData.rules);
    setTags(tagData.tags);
    setAttributeExpansions(expansionData.expansions);
    setAttributeExpansionLoadError('failed' in expansionData && expansionData.failed === true);
  };

  const inviteEditor = async () => {
    setInviting(true);
    try {
      await api.inviteEditor(email, role, note);
      setEmail('');
      setNote('');
      await load();
      showToast('已建立編輯者授權。');
    } catch (caught) {
      const message = caught instanceof ApiError && caught.code === 'invalid_email'
        ? 'Google 信箱格式不正確。'
        : '無法建立編輯者授權，請稍後再試。';
      showToast(message, 'error');
    } finally {
      setInviting(false);
    }
  };

  const revokeEditorAccess = async (row: EditorAccessUser) => {
    try {
      await api.revokeEditor(row.id, row.role);
      await load();
      showToast('已撤銷權限。');
    } catch (caught) {
      const message = caught instanceof ApiError && caught.code === 'last_admin_role'
        ? '不能撤銷最後一位管理員；請先授予另一個帳號 Admin 權限。'
        : '無法撤銷權限，請稍後再試。';
      showToast(message, 'error');
    }
  };

  const revokeInvitation = async (id: string) => {
    try {
      await api.revokeInvitation(id);
      await load();
      showToast('已取消邀請。');
    } catch {
      showToast('無法取消邀請，請稍後再試。', 'error');
    }
  };
  useEffect(() => { if (realIsAdmin) void load(); }, [realIsAdmin]);

  const handleClearLocalData = async () => {
    if (await confirm({ title: '清除本機快取？', message: '不會影響雲端資料庫，也不會刪除草稿或待送出資料。', confirmLabel: '清除快取', tone: 'danger' })) {
      await localDb.clearCache({ includeTags: true });
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
    await localDb.invalidateTagEntity(tag.id);
    clearPublicTagCache();
    showToast(`已將 #${tag.name} 設定為 ${!tag.isPublic ? '公共 Tag' : '非公共 Tag'}`);
    await load();
  };

  const handleUpdateTagDetails = async (tag: TagSummary, input: { name: string; aliases: string[]; categoryHints: RuleCategory[]; detectionKeywords: string[] }) => {
    await api.updateAdminTag(tag.id, input);
    await localDb.invalidateTagEntity(tag.id);
    clearPublicTagCache();
    showToast(`已更新 #${input.name}`);
    await load();
  };

  const handleMergeTags = async () => {
    const source = tags.find((tag) => tag.id === sourceTagId);
    const target = tags.find((tag) => tag.id === targetTagId);
    if (!source || !target || source.id === target.id) return;
    const approved = await confirm({
      title: '合併 Tag？',
      message: `所有 #${source.name} 的規則會改用 #${target.name}，原名稱會保留為別名。`,
      confirmLabel: '合併 Tag',
      tone: 'danger',
    });
    if (!approved) return;
    await api.mergeAdminTag(source.id, target.id);
    await localDb.clearCache({ includeTags: true });
    clearPublicTagCache();
    clearSearchCache();
    setSourceTagId('');
    setTargetTagId('');
    showToast(`已將 #${source.name} 合併到 #${target.name}`);
    await load();
  };

  const handleSaveAttributeExpansion = async (expansion: AttributeExpansionMetadata, input: { englishName: string | null; aliases: string[] }) => {
    const key = `${expansion.subjectId}:${expansion.componentOrder}`;
    setSavingAttributeExpansion(key);
    try {
      const result = await api.updateAdminAttributeExpansion(expansion.subjectId, expansion.componentOrder, input);
      setAttributeExpansions((current) => current.map((item) => item.subjectId === expansion.subjectId && item.componentOrder === expansion.componentOrder ? result.expansion : item));
      showToast('擴充英文名稱與別名已儲存。');
    } catch {
      showToast('擴充資料儲存失敗，請稍後再試。', 'error');
    } finally {
      setSavingAttributeExpansion(undefined);
    }
  };

  const filteredTags = tags.filter((t) => !tagQuery || t.name.includes(tagQuery)
    || t.aliases?.some((alias) => alias.includes(tagQuery))
    || t.detectionKeywords?.some((keyword) => keyword.includes(tagQuery)));

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
      <section className="admin-card">
        <div className="list-heading"><h2>編輯權限管理</h2><span>{editors.users.length + editors.invitations.length} 人</span></div>
        <p className="muted">所有編輯者與管理員權限皆透過此頁面管理。輸入對方的 Google 信箱即可授予權限，對方首次登入後自動生效。</p>
        {editorLoadError && <p className="form-error">{editorLoadError} <button type="button" className="text-action" onClick={() => void load()}>重試</button></p>}
        <form onSubmit={(event) => { event.preventDefault(); void inviteEditor(); }}>
          <label>Google 信箱<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@gmail.com" /></label>
          <label>授權備註 (選填)<input type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：黃紹東 (FB聯繫)" /></label>
          <label>角色<select value={role} onChange={(event) => setRole(event.target.value as 'editor' | 'admin')}><option value="editor">Editor</option><option value="admin">Admin</option></select></label>
          <button className="button primary" type="submit" disabled={inviting}>{inviting ? '建立中…' : '新增／邀請'}</button>
        </form>
        <div className="admin-list">
          {editors.users.map((row, index) => <div key={`${row.id}-${row.role}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <strong style={{ marginRight: '0.5rem', color: 'var(--text)' }}>{row.displayName || row.maskedEmail || '編輯者'}</strong>
              {row.maskedEmail && row.displayName && <small style={{ marginRight: '0.5rem', color: 'var(--muted)' }}>({row.maskedEmail})</small>}
              <small style={{ background: 'var(--accent-dim, #f0f4f8)', padding: '2px 8px', borderRadius: '4px', textTransform: 'capitalize' }}>
                {row.role}{row.revokedAt ? '・已撤銷' : ''}
              </small>
            </span>
            {!row.revokedAt && <button type="button" className="danger-link" onClick={() => void confirm({ title: '撤銷權限？', message: `撤銷 ${row.displayName || row.maskedEmail} 的 ${row.role} 權限？`, confirmLabel: '撤銷權限', tone: 'danger' }).then((confirmed) => { if (confirmed) return revokeEditorAccess(row); })}>撤銷</button>}
          </div>)}
          {editors.invitations.map((row) => <div key={String(row.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <strong style={{ marginRight: '0.5rem', color: 'var(--text)' }}>{String(row.note ? `${row.note} (${row.maskedEmail})` : row.maskedEmail)}</strong>
              <small style={{ background: 'var(--accent-dim, #f0f4f8)', padding: '2px 8px', borderRadius: '4px', textTransform: 'capitalize' }}>
                {row.role}・等待首次登入
              </small>
            </span>
            <button type="button" className="danger-link" onClick={() => void revokeInvitation(row.id)}>取消</button>
          </div>)}
        </div>
      </section>

      <section className="admin-card">
        <div className="list-heading"><h2>Tag 管理</h2><span>{tags.length} 個</span></div>
        <p className="muted">公共 Tag 可供所有遊戲選用，分類關鍵字也會隨公共目錄同步；非公共 Tag 為遊戲專屬自訂標籤。</p>
        <form onSubmit={(e) => void handleCreatePublicTag(e)} style={{ marginBottom: '1rem' }}>
          <label>新增公共 Tag 名稱<input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="例如：玩家互動、盲拍" required /></label>
          <label>標籤說明 (可選)<input value={newTagDesc} onChange={(e) => setNewTagDesc(e.target.value)} placeholder="說明此標籤適用的機制或時機" /></label>
          <button type="submit" className="button primary">建立公共 Tag</button>
        </form>
        <label>搜尋 Tag<input type="search" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)} placeholder="搜尋 Tag 名稱…" /></label>
        <div className="admin-list" style={{ maxHeight: '350px', overflowY: 'auto' }}>
          {filteredTags.map((tag) => (
            <AdminTagEditor
              key={tag.id}
              tag={tag}
              onSave={(input) => handleUpdateTagDetails(tag, input)}
              onTogglePublic={handleTogglePublic}
            />
          ))}
        </div>
        <div className="admin-tag-merge">
          <h3>合併重複 Tag</h3>
          <p className="muted">規則會統一改用目標 Tag；來源名稱與既有別名仍可供內容偵測與舊輸入對應。</p>
          <label>來源 Tag<select value={sourceTagId} onChange={(event) => setSourceTagId(event.target.value)}><option value="">請選擇</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>#{tag.name}（{tag.usageCount ?? 0}）</option>)}</select></label>
          <label>合併到<select value={targetTagId} onChange={(event) => setTargetTagId(event.target.value)}><option value="">請選擇</option>{tags.filter((tag) => tag.id !== sourceTagId).map((tag) => <option key={tag.id} value={tag.id}>#{tag.name}（{tag.usageCount ?? 0}）</option>)}</select></label>
          <button type="button" className="button secondary" disabled={!sourceTagId || !targetTagId || sourceTagId === targetTagId} onClick={() => void handleMergeTags()}>合併 Tag</button>
        </div>
      </section>

      <section className="admin-card admin-attribute-expansions-card">
        <div className="list-heading"><h2>屬性投票的擴充名稱</h2><span>{attributeExpansions.length} 項</span></div>
        <p className="muted">這裡只管理屬性投票配置中的擴充英文名稱與別名，不會加入一般遊戲搜尋，也不會修改玩錯規則資料。</p>
        {attributeExpansionLoadError && <p className="form-error">無法載入擴充資料，請重試。</p>}
        {!attributeExpansionLoadError && attributeExpansions.length === 0 && <p className="muted">目前沒有可編輯的擴充配置。</p>}
        <div className="admin-attribute-expansions-list">
          {attributeExpansions.map((expansion) => {
            const key = `${expansion.subjectId}:${expansion.componentOrder}`;
            return <AdminAttributeExpansionEditor
              key={key}
              expansion={expansion}
              saving={savingAttributeExpansion === key}
              onSave={(input) => handleSaveAttributeExpansion(expansion, input)}
            />;
          })}
        </div>
      </section>

      <section className="admin-card import-card"><div className="list-heading"><h2>舊資料待確認</h2><span>{importRows.length} 筆</span></div>
        {importRows.length === 0 && <p className="muted">目前沒有 staged 資料。執行匯入指令後會在這裡出現。</p>}
        {importRows.slice(0, 20).map((row) => <article key={String(row.id)}><strong>{String(row.raw_game_name)}</strong><p>{String(row.raw_rule_text)}</p><small>原始第 {String(row.source_row_number)} 列・宣告 {String(row.declared_rule_count ?? '?')} 條</small>
          <div className="inline-actions"><button type="button" className="text-action" onClick={() => void api.confirmImport(String(row.id)).then(async () => { await localDb.clearCache(); clearSearchCache(); showToast('已確認並匯入這筆舊資料。'); return load(); })}>按建議拆分匯入</button>
            <button type="button" className="danger-link" onClick={() => void api.skipImport(String(row.id)).then(load)}>略過</button></div></article>)}
      </section>

      <section className="admin-card"><h2>合併重複遊戲</h2><p className="muted">來源遊戲的規則與別名會移到目標遊戲，原名稱仍可搜尋。</p>
        <GameSearch value={sourceQuery} selectedId={sourceGame?.id} includeGamesWithoutPublishedRules onChange={(value) => { setSourceQuery(value); if (sourceGame && value !== sourceGame.displayName) setSourceGame(undefined); }} onSelect={(game) => { setSourceGame(game); setSourceQuery(game.displayName); }} />
        <div className="merge-arrow">↓ 合併到</div>
        <GameSearch value={targetQuery} selectedId={targetGame?.id} includeGamesWithoutPublishedRules onChange={(value) => { setTargetQuery(value); if (targetGame && value !== targetGame.displayName) setTargetGame(undefined); }} onSelect={(game) => { setTargetGame(game); setTargetQuery(game.displayName); }} />
        <button type="button" className="button primary full-button" disabled={!sourceGame || !targetGame || sourceGame.id === targetGame.id}
          onClick={() => { if (sourceGame && targetGame) void confirm({ title: '合併遊戲？', message: `將「${sourceGame.displayName}」合併到「${targetGame.displayName}」？`, confirmLabel: '合併遊戲', tone: 'danger' }).then((confirmed) => { if (confirmed) return api.mergeGame(sourceGame.id, targetGame.id).then(async () => { await localDb.invalidateGame(sourceGame.slug); await localDb.invalidateGame(targetGame.slug); clearSearchCache(); showToast('遊戲已合併，舊名稱保留為別名。'); setSourceGame(undefined); setTargetGame(undefined); setSourceQuery(''); setTargetQuery(''); }); }); }}>合併遊戲</button>
      </section>

      <section className="admin-card"><div className="list-heading"><h2>已隱藏規則</h2><span>{hiddenRules.length} 條</span></div>
        <div className="admin-list">{hiddenRules.map((rule) => <div key={rule.id}><strong>{rule.statement}</strong><button type="button" className="text-action" onClick={() => void api.restoreRule(rule.id).then(async () => { await localDb.clearCache(); clearSearchCache(); load(); })}>恢復</button></div>)}</div>
      </section>
    </div>
  </section>;
};
