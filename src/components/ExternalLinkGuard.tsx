import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { isDirectExternalUrl, parseSafeExternalUrl } from '../shared/externalUrl';

interface ExternalLinkGuardProps {
  url: string;
  children: React.ReactNode;
  className?: string;
}

export const ExternalLinkGuard = ({ url, children, className }: ExternalLinkGuardProps) => {
  const safeUrl = parseSafeExternalUrl(url);
  const direct = isDirectExternalUrl(url);
  const [open, setOpen] = useState(false);

  if (!safeUrl) return <span className={className} title="此來源網址無法安全驗證">{children}</span>;

  const openExternal = () => {
    window.open(safeUrl.href, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return <>
    <button
      type="button"
      className={className ? `${className} external-link-button` : 'external-link-button'}
      onClick={(event) => {
        event.stopPropagation();
        if (direct) openExternal();
        else setOpen(true);
      }}
    >
      {children}
    </button>
    <ConfirmDialog
      open={open}
      title="即將離開本站"
      message={`你即將開啟外部網站：${safeUrl.hostname}\n${safeUrl.href}`}
      confirmLabel="繼續前往"
      cancelLabel="取消"
      onConfirm={openExternal}
      onCancel={() => setOpen(false)}
    />
  </>;
};
