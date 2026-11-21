import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import zhTWCopy from '../content/zh-TW.json';
import { useSession } from '../context/SessionContext';
import type { SessionUser } from '../shared/types';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';

// A grant older than this is not news; accounts trusted long ago never see the notice.
export const ROLE_NOTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const copy = zhTWCopy.author.editorGrantNotice;

export const roleNoticeKey = (user: Pick<SessionUser, 'id' | 'roleGrantedAt'>) => `role-notice-seen:${user.id}:${user.roleGrantedAt}`;

const readSeen = (key: string) => {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
};

/** The author's letter is written for editors; admin access is granted only by hand. */
export const shouldShowRoleNotice = (user: SessionUser | null | undefined, currentTime = Date.now()) => Boolean(
  user?.roleGrantedAt
  && user.roles.includes('editor')
  && currentTime - user.roleGrantedAt < ROLE_NOTICE_WINDOW_MS
  && !readSeen(roleNoticeKey(user)),
);

// The site never keeps the Google profile name, so the letter greets the account's own nickname.
export const roleNoticeTitle = (user: Pick<SessionUser, 'nickname'>) => user.nickname
  ? copy.titleWithName.replace('{name}', user.nickname)
  : copy.title;

/** Tells a contributor once, on each device, that they were given editor access. */
export const RoleGrantNotice = () => {
  const { user } = useSession();
  const location = useLocation();
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dismissedKey, setDismissedKey] = useState<string>();
  // Attribute voting is a separate audience; the notice is about the rules site.
  const open = !location.pathname.startsWith('/attributes') && shouldShowRoleNotice(user)
    && dismissedKey !== (user ? roleNoticeKey(user) : undefined);
  const dismiss = () => {
    if (!user) return;
    const key = roleNoticeKey(user);
    try { localStorage.setItem(key, '1'); } catch { /* still closes for this visit */ }
    setDismissedKey(key);
  };
  useWorkspaceBrowserBack({ active: open, onBack: dismiss });
  useEffect(() => { if (open) buttonRef.current?.focus(); }, [open]);
  if (!open || !user) return null;
  return createPortal(<div className="modal-backdrop" role="presentation">
    <section className="modal confirm-dialog role-grant-notice" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="role-grant-letter">
        <h2 id={titleId}>{roleNoticeTitle(user)}</h2>
        {copy.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p className="role-grant-signature">{copy.signature}</p>
      </div>
      <div className="confirm-dialog-actions">
        <button ref={buttonRef} type="button" className="button primary" onClick={dismiss}>{copy.dismiss}</button>
      </div>
    </section>
  </div>, document.body);
};
