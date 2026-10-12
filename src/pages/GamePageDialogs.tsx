import { useEffect, useMemo, useState } from 'react';
import { EditionInput } from '../components/EditionInput';
import { ExternalLinkGuard } from '../components/ExternalLinkGuard';
import { PlayerCountInput } from '../components/PlayerCountInput';
import { RuleCategoryInput } from '../components/RuleCategoryInput';
import { TagInput } from '../components/TagInput';
import zhTWCopy from '../content/zh-TW.json';
import { useConfirm } from '../context/ConfirmContext';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import { collectEditionOptions } from '../lib/editionOptions';
import { localDb } from '../lib/localDb';
import { canUserReviewRule } from '../lib/rulePermissions';
import { GAME_EXTERNAL_RESOURCE_CATEGORIES, type GameDetail, type GameExternalResource, type GameExternalResourceCategory, type RuleCard as RuleCardType, type RuleRevision, type TagSelection } from '../shared/types';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';

const RESOURCE_CATEGORY_LABELS: Record<GameExternalResourceCategory, string> = {
  teaching: '教學',
  help_card: '幫助卡',
  faq: 'FAQ',
};

export const ExternalResourcesDialog = ({ game, canEdit, onClose, onChanged }: { game: GameDetail; canEdit: boolean; onClose(): void; onChanged(): Promise<void> }) => {
  const [addOpen, setAddOpen] = useState(false);
  useWorkspaceBrowserBack({ active: true, onBack: onClose });
  const resources = game.externalResources ?? [];
  return <>
    <div className="modal-backdrop" role="presentation">
      <div className="modal external-resource-dialog" role="dialog" aria-modal="true" aria-labelledby="external-resource-title">
        <div className="modal-heading"><h2 id="external-resource-title">外部資源</h2><button type="button" aria-label="關閉外部資源" onClick={onClose}>×</button></div>
        <div className="external-resource-list">
          {resources.length === 0 && <p className="muted">尚未新增外部資源。</p>}
          {resources.map((resource) => <div className="external-resource-item" key={resource.id}>
            <div><strong>{resource.name}</strong><small>{RESOURCE_CATEGORY_LABELS[resource.category]}</small><ExternalLinkGuard url={resource.url}>{resource.url}</ExternalLinkGuard></div>
            {canEdit && <ExternalResourceDeleteButton game={game} resource={resource} onChanged={onChanged} />}
          </div>)}
        </div>
        <div className="modal-actions"><span />
          {canEdit && <button type="button" className="button primary" onClick={() => setAddOpen(true)}>新增</button>}
          <button type="button" className="button secondary" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
    {canEdit && addOpen && <ExternalResourceAddDialog game={game} onClose={() => setAddOpen(false)} onSaved={async () => { await onChanged(); setAddOpen(false); }} />}
  </>;
};

const ExternalResourceDeleteButton = ({ game, resource, onChanged }: { game: GameDetail; resource: GameExternalResource; onChanged(): Promise<void> }) => {
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState<string>();
  const remove = async () => {
    if (!(await confirm({ title: '刪除此資源？', message: resource.name, confirmLabel: '刪除', tone: 'danger' }))) return;
    setDeleting(resource.id);
    try {
      await api.deleteGameExternalResource(game.id, resource.id);
      await onChanged();
      showToast('已刪除外部資源');
    } catch { showToast('外部資源刪除失敗，請稍後再試。', 'error'); }
    finally { setDeleting(undefined); }
  };
  return <button type="button" className="danger-link" disabled={deleting === resource.id} onClick={() => void remove()}>刪除</button>;
};

const ExternalResourceAddDialog = ({ game, onClose, onSaved }: { game: GameDetail; onClose(): void; onSaved(): Promise<void> }) => {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<GameExternalResourceCategory>('teaching');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  useWorkspaceBrowserBack({ active: true, onBack: onClose });
  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await api.createGameExternalResource(game.id, { name: name.trim(), category, url: url.trim() });
      await onSaved();
      showToast('已新增外部資源');
    } catch { showToast('外部資源新增失敗，請確認網址後再試。', 'error'); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop external-resource-add-backdrop" role="presentation">
    <form className="modal text-input-dialog external-resource-add-dialog" role="dialog" aria-modal="true" aria-labelledby="external-resource-add-title" onSubmit={(event) => { event.preventDefault(); void add(); }}>
      <div className="modal-heading"><h2 id="external-resource-add-title">新增外部資源</h2><button type="button" aria-label="關閉新增外部資源" onClick={onClose}>×</button></div>
      <label>名稱<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：官方教學" /></label>
      <label>類別<select value={category} onChange={(event) => setCategory(event.target.value as GameExternalResourceCategory)}>{GAME_EXTERNAL_RESOURCE_CATEGORIES.map((value) => <option key={value} value={value}>{RESOURCE_CATEGORY_LABELS[value]}</option>)}</select></label>
      <label>連結<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
      <small className="muted">若遊戲已有介紹文章，優先填入介紹文章連結。</small>
      <div className="confirm-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={saving || !name.trim() || !url.trim()}>{saving ? '新增中…' : '新增'}</button></div>
    </form>
  </div>;
};

export const RuleEditor = ({ game, rule, onClose, onSaved }: { game: GameDetail; rule: RuleCardType; onClose(): void; onSaved(): Promise<void> }) => {
  useWorkspaceBrowserBack({ active: true, onBack: onClose });
  const { isAdmin, canEdit, user } = useSession();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [statement, setStatement] = useState(rule.statement);
  const [commonMistake, setCommonMistake] = useState(rule.commonMistake ?? '');
  const [details, setDetails] = useState(rule.details ?? '');
  const [categories, setCategories] = useState(rule.categories ?? []);
  const [playerCounts, setPlayerCounts] = useState(rule.playerCounts ?? []);
  const [editionNotes, setEditionNotes] = useState(rule.editionNotes ?? (rule.editionNote ? [rule.editionNote] : []));
  const [tagSelections, setTagSelections] = useState<TagSelection[]>(rule.tags.map((tag) => ({ id: tag.id, name: tag.name, unresolved: tag.unresolved })));
  const [sourceLabel, setSourceLabel] = useState(rule.sourceLabel ?? '');
  const [sourceUrl, setSourceUrl] = useState(rule.sourceUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState<RuleRevision[]>();
  const canWithdraw = !canEdit && rule.reviewStatus === 'pending' && rule.createdBy === user?.id;
  const editionOptions = useMemo(() => collectEditionOptions(game.rules), [game.rules]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('keydown', closeOnEscape); };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      const response = await api.patchRule(rule.id, {
        ...(rule.updatedAt === undefined ? {} : { baseUpdatedAt: rule.updatedAt }),
        statement, commonMistake: commonMistake || null, details: details || null, categories, playerCounts, editionNotes,
        tagIds: tagSelections.flatMap((tag) => tag.id ? [tag.id] : []),
        newTagNames: tagSelections.flatMap((tag) => tag.id ? [] : [tag.name]),
        sourceLabel: sourceLabel || null, sourceUrl: sourceUrl || null,
      });
      if (response.reviewStatus === 'pending') showToast('修改已送交審核。', 'info');
      await onSaved();
    } catch (caught) {
      showToast(caught instanceof ApiError && caught.code === 'PENDING_RULE_LIMIT_REACHED'
        ? '待審核額度已用完，無法修改這條規則。'
        : caught instanceof ApiError && caught.code === 'rule_changed_while_editing'
          ? '這條規則在你開始編輯後已有更新，請關閉編輯器後重新載入。'
          : '規則儲存失敗，請稍後再試。', 'error');
    } finally { setSaving(false); }
  };
  const hide = async () => {
    if (await confirm({ title: '隱藏規則？', message: canWithdraw ? '隱藏後可從帳號頁恢復。' : '隱藏後仍可從管理頁恢復。', confirmLabel: '隱藏規則', tone: 'danger' })) {
      await api.hideRule(rule.id); await onSaved();
    }
  };
  const review = async () => {
    setSaving(true);
    try {
      await api.reviewRule(rule.id);
      await localDb.invalidateHome();
      await onSaved();
    } catch (caught) {
      showToast(caught instanceof ApiError && caught.code === 'reviewer_nickname_required'
        ? '請先在帳號頁設定並公開顯示暱稱，才能完成審核。'
        : '審核失敗，請稍後再試。');
    } finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-rule-title">
      <div className="modal-heading"><h2 id="edit-rule-title">編輯規則</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>{zhTWCopy.terms.correctRule}<textarea rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
      <label>{zhTWCopy.terms.mistakeSituation}<textarea rows={2} value={commonMistake} onChange={(event) => setCommonMistake(event.target.value)} /></label>
      <label>補充說明<textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <TagInput value={tagSelections} onChange={setTagSelections} canCreate={isAdmin} availableTags={game.rules.flatMap((gameRule) => gameRule.tags).filter((tag) => !tag.unresolved)} detectionInput={{ statement, commonMistake, details }} />
      <RuleCategoryInput value={categories} onChange={setCategories} />
      <PlayerCountInput value={playerCounts} onChange={setPlayerCounts} />
      <EditionInput value={editionNotes} options={editionOptions} variants={game.variants ?? []} onChange={setEditionNotes} />
      <div className="two-columns"><label>參考資料<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} /></label><label>資料網址<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label></div>
      {user && <section className="revision-panel">
        <button type="button" className="text-action" onClick={() => void api.ruleRevisions(rule.id).then((data) => setRevisions(data.revisions))}>查看版本紀錄</button>
        {revisions && (revisions.length ? <div className="admin-list">{revisions.map((revision) => <div key={revision.id}>
          <span><strong>{revision.previousStatement}</strong><small>{new Date(revision.createdAt).toLocaleString('zh-TW')}・{revision.reason}</small></span>
          {canEdit && <button type="button" className="text-action" onClick={() => void confirm({ title: '恢復這個版本？', message: '目前內容也會保留在版本紀錄中。', confirmLabel: '恢復版本' }).then((confirmed) => { if (confirmed) return api.restoreRevision(rule.id, revision.id).then(onSaved); })}>恢復</button>}
        </div>)}</div> : <p className="muted">尚無較早版本。</p>)}
      </section>}
      <div className="modal-actions">{(canEdit || canWithdraw) ? <button type="button" className="danger-link" onClick={() => void hide()}>{canEdit ? '隱藏' : '撤回投稿'}</button> : <span />}<div><button type="button" className="button secondary" onClick={onClose}>取消</button>{canUserReviewRule(rule, user) && <button type="button" className="button secondary" disabled={saving} onClick={() => void review()}>審核</button>}<button type="button" className="button primary" disabled={!statement.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存修改'}</button></div></div>
    </div>
  </div>;
};

export const GameEditor = ({ game, onClose, onSaved }: { game: GameDetail; onClose(): void; onSaved(): Promise<void> }) => {
  useWorkspaceBrowserBack({ active: true, onBack: onClose });
  const [displayName, setDisplayName] = useState(game.displayName);
  const [englishName, setEnglishName] = useState(game.englishName ?? '');
  const [aliases, setAliases] = useState(game.aliases.filter((alias) => alias !== game.displayName && alias !== game.englishName).join('\n'));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('keydown', closeOnEscape); };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      await api.patchGame(game.id, { displayName, englishName: englishName || undefined, aliases: aliases.split('\n').map((value) => value.trim()).filter(Boolean) });
      await onSaved();
    } finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-game-title">
      <div className="modal-heading"><h2 id="edit-game-title">編輯遊戲名稱</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>顯示名稱<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>英文名稱<input value={englishName} onChange={(event) => setEnglishName(event.target.value)} /></label>
      <label>可搜尋的別名（每行一個）<textarea rows={5} value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
      <div className="modal-actions"><span /><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={!displayName.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存遊戲'}</button></div></div>
    </div>
  </div>;
};
