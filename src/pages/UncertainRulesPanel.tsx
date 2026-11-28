import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UncertainRuleFields, uncertainRuleInput, type UncertainRuleDraft } from '../components/UncertainRuleFields';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { buildUncertainRuleAiPrompt, buildUncertainRulePost } from '../lib/uncertainRulePost';
import { collectEditionOptions } from '../lib/editionOptions';
import { uncertainRulesApi } from '../lib/uncertainRulesApi';
import { RULE_CATEGORY_LABELS, type GameDetail, type UncertainRule } from '../shared/types';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const checkStatusLabel = (rule: UncertainRule) => rule.checkedAt === null ? '沒查過BGG' : `已查過BGG無答案・${formatDate(rule.checkedAt)}`;

/** The optional settings in one line, as a recorded rule's card shows them. */
const settingsLabel = (rule: UncertainRule) => [
  ...(rule.categories ?? []).map((category) => RULE_CATEGORY_LABELS[category]),
  ...(rule.playerCounts?.length ? [`${rule.playerCounts.join('、')} 人`] : []),
  ...(rule.editionNotes ?? []),
].join('・');

/** 不確定的桌遊規則: the game page's uncertain side, the admin's private list of unanswered rules questions. */
export const UncertainRulesPanel = ({ game }: { game: GameDetail }) => {
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [rules, setRules] = useState<UncertainRule[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<UncertainRule>();
  const [busyId, setBusyId] = useState<string>();

  const load = () => {
    setLoadFailed(false);
    uncertainRulesApi.list(game.id).then((response) => setRules(response.uncertainRules)).catch(() => setLoadFailed(true));
  };
  useEffect(load, [game.id]);

  const replace = (rule: UncertainRule) => setRules((current) => current?.some((candidate) => candidate.id === rule.id)
    ? current.map((candidate) => candidate.id === rule.id ? rule : candidate)
    : [...(current ?? []), rule]);
  const toggleSelected = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setChecked = async (rule: UncertainRule, checked: boolean) => {
    setBusyId(rule.id);
    try { replace((await uncertainRulesApi.update(game.id, rule.id, { checked })).uncertainRule); }
    catch { showToast('更新失敗，請稍後再試。', 'error'); }
    finally { setBusyId(undefined); }
  };
  const remove = async (rule: UncertainRule) => {
    if (!(await confirm({ title: '刪除這個不確定的規則？', message: rule.question, confirmLabel: '刪除', tone: 'danger' }))) return;
    setBusyId(rule.id);
    try {
      await uncertainRulesApi.remove(game.id, rule.id);
      setRules((current) => current?.filter((candidate) => candidate.id !== rule.id));
      setSelected((current) => { const next = new Set(current); next.delete(rule.id); return next; });
    } catch { showToast('刪除失敗，請稍後再試。', 'error'); }
    finally { setBusyId(undefined); }
  };
  const selectedRules = (rules ?? []).filter((rule) => selected.has(rule.id));
  const copy = async (forAi: boolean) => {
    const text = (forAi ? buildUncertainRuleAiPrompt : buildUncertainRulePost)(game, selectedRules);
    try {
      await navigator.clipboard.writeText(text);
      showToast(forAi ? `已複製 ${selectedRules.length} 題給 AI 翻譯` : `已複製 ${selectedRules.length} 題的發文`);
    } catch { showToast('複製失敗，請稍後再試。', 'error'); }
  };

  return <section className="uncertain-rules" aria-label="不確定的桌遊規則">
    <div className="uncertain-rules-toolbar">
      <span className="muted">{selectedRules.length ? `已選 ${selectedRules.length} 題` : '勾選要一起問的題目'}</span>
      <button type="button" className="button secondary" disabled={selectedRules.length === 0} onClick={() => void copy(false)}>複製發文</button>
      <button type="button" className="button secondary" disabled={selectedRules.length === 0} onClick={() => void copy(true)}>複製給 AI</button>
    </div>
    <div className="uncertain-rule-list">
      {loadFailed && <div className="game-load-error" role="alert"><p>暫時無法載入。</p><button type="button" className="button secondary" onClick={load}>重新載入</button></div>}
      {!loadFailed && !rules && <p className="muted">載入中…</p>}
      {rules?.length === 0 && <div className="empty-state"><p>還沒有記下不確定的規則。</p><Link className="text-action" to={`/add?game=${encodeURIComponent(game.slug)}`}>記下第一題</Link></div>}
      {rules?.map((rule) => <div className="uncertain-rule-item" key={rule.id}>
        <label className="uncertain-rule-pick">
          <input type="checkbox" checked={selected.has(rule.id)} onChange={() => toggleSelected(rule.id)} />
          <span><strong>{rule.question}</strong>
            {rule.tableRuling && <small>先這樣玩：{rule.tableRuling}</small>}
            {rule.details && <small>{rule.details}</small>}
            {settingsLabel(rule) && <small className="uncertain-rule-settings">{settingsLabel(rule)}</small>}
            <small className={rule.checkedAt === null ? 'uncertain-rule-status unchecked' : 'uncertain-rule-status'}>{checkStatusLabel(rule)}</small>
          </span>
        </label>
        <div className="uncertain-rule-actions">
          <button type="button" className="text-action" disabled={busyId === rule.id} onClick={() => void setChecked(rule, true)}>{rule.checkedAt === null ? '已查過BGG無答案' : '重新查過BGG'}</button>
          {rule.checkedAt !== null && <button type="button" className="text-action" disabled={busyId === rule.id} onClick={() => void setChecked(rule, false)}>改回沒查過BGG</button>}
          <button type="button" className="text-action" disabled={busyId === rule.id} onClick={() => setEditing(rule)}>編輯</button>
          <button type="button" className="danger-link" disabled={busyId === rule.id} onClick={() => void remove(rule)}>刪除</button>
        </div>
      </div>)}
    </div>
    {editing && <UncertainRuleEditor game={game} rule={editing} onClose={() => setEditing(undefined)}
      onSaved={(rule) => { replace(rule); setEditing(undefined); }} />}
  </section>;
};

const UncertainRuleEditor = ({ game, rule, onClose, onSaved }: { game: GameDetail; rule: UncertainRule; onClose(): void; onSaved(rule: UncertainRule): void }) => {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<UncertainRuleDraft>({
    question: rule.question, tableRuling: rule.tableRuling ?? '', details: rule.details ?? '',
    categories: rule.categories ?? [], playerCounts: rule.playerCounts ?? [], editionNotes: rule.editionNotes ?? [],
  });
  const [saving, setSaving] = useState(false);
  const editionOptions = useMemo(() => collectEditionOptions(game.rules), [game.rules]);
  useWorkspaceBrowserBack({ active: true, onBack: onClose });
  const save = async () => {
    if (!draft.question.trim()) return;
    setSaving(true);
    try { onSaved((await uncertainRulesApi.update(game.id, rule.id, uncertainRuleInput(draft))).uncertainRule); }
    catch { showToast('儲存失敗，請稍後再試。', 'error'); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop uncertain-rule-editor-backdrop" role="presentation">
    <form className="modal uncertain-rule-editor" role="dialog" aria-modal="true" aria-labelledby="uncertain-rule-editor-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="modal-heading"><h2 id="uncertain-rule-editor-title">編輯不確定的規則</h2><button type="button" aria-label="關閉" onClick={onClose}>×</button></div>
      <UncertainRuleFields value={draft} onChange={setDraft} editionOptions={editionOptions} variants={game.variants ?? []} autoFocus />
      <div className="confirm-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={saving || !draft.question.trim()}>{saving ? '儲存中…' : '儲存'}</button></div>
    </form>
  </div>;
};
