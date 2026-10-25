import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPwaInstallState, pwaInstallInstructions, requestPwaInstall, subscribePwaInstall } from '../lib/pwaInstall';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';

export const PwaInstallButton = () => {
  const state = useSyncExternalStore(subscribePwaInstall, getPwaInstallState, getPwaInstallState);
  const [helpOpen, setHelpOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useWorkspaceBrowserBack({ active: helpOpen && state !== 'installed', onBack: () => setHelpOpen(false) });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (helpOpen && state !== 'installed') dialog?.showModal();
    else dialog?.close();
  }, [helpOpen, state]);

  if (state === 'installed') return null;
  return <>
    <button type="button" className="pwa-install-button" disabled={state === 'prompting'} onClick={() => {
      void requestPwaInstall().then((outcome) => { if (outcome === 'manual') setHelpOpen(true); });
    }}>
      <span aria-hidden="true">＋</span>加入主畫面
    </button>
    <dialog ref={dialogRef} className="pwa-install-help" aria-labelledby="pwa-install-title"
      onCancel={(event) => { event.preventDefault(); setHelpOpen(false); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) setHelpOpen(false);
      }}>
      <h2 id="pwa-install-title">加入主畫面</h2>
      <p>{pwaInstallInstructions()}</p>
      <button type="button" className="button primary" onClick={() => setHelpOpen(false)}>知道了</button>
    </dialog>
  </>;
};
