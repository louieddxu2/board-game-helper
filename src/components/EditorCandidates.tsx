import type { EditorCandidate } from '../shared/types';

const candidateName = (candidate: EditorCandidate) => candidate.nickname || candidate.maskedEmail;

// Signed-in accounts without a role, most active contributors first; granting needs no email.
export const EditorCandidates = ({ candidates, onGrant }: { candidates: EditorCandidate[]; onGrant: (candidate: EditorCandidate) => void }) => (
  <div className="editor-candidates">
    <h3>直接授權已登入的使用者</h3>
    {candidates.length === 0
      ? <p className="muted">目前沒有尚未授權的使用者。</p>
      : <div className="admin-list">
        {candidates.map((candidate) => <div key={candidate.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span>
            <strong style={{ marginRight: '0.5rem', color: 'var(--text)' }}>{candidateName(candidate)}</strong>
            <small style={{ color: 'var(--muted)' }}>
              {candidate.maskedEmail}・{candidate.ruleCount} 條規則{candidate.pendingRuleCount ? `（${candidate.pendingRuleCount} 條未審核）` : ''}
            </small>
          </span>
          <button type="button" className="text-action" onClick={() => onGrant(candidate)}>授予 Editor</button>
        </div>)}
      </div>}
  </div>
);

export { candidateName };
