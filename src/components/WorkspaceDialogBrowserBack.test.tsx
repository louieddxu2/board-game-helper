// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { TextInputDialog } from './TextInputDialog';
import { uiHistory } from '../workspace/uiHistory';
import { ConfirmProvider, useConfirm } from '../context/ConfirmContext';

const historyKey = '__boardGameHelperWorkspaceUi';
let baselineHistoryState: unknown;
let baselineHistoryUrl = '';
let popCount = 0;
const capturePop = () => { popCount += 1; };

const marker = () => (window.history.state as Record<string, unknown> | null)?.[historyKey];
const historyIndex = (state: unknown) => state && typeof state === 'object' && typeof (state as { idx?: unknown }).idx === 'number'
  ? (state as { idx: number }).idx : 0;
const startHistoryCase = () => {
  const index = historyIndex(window.history.state);
  window.history.pushState({ ...(window.history.state ?? {}), idx: index + 1 }, '', '/__dialog-browser-back-previous');
  window.history.pushState({ ...(window.history.state ?? {}), idx: index + 2 }, '', '/__dialog-browser-back-current');
};
beforeEach(() => {
  uiHistory.dispose();
  baselineHistoryState = window.history.state;
  baselineHistoryUrl = window.location.href;
  startHistoryCase();
  popCount = 0;
  window.addEventListener('popstate', capturePop, true);
});

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(marker()).toBeUndefined(), { timeout: 1500 });
  uiHistory.dispose();
  window.removeEventListener('popstate', capturePop, true);
  window.history.replaceState(baselineHistoryState, '', baselineHistoryUrl);
});

describe('dialog browser-back contracts', () => {
  it('resolves a ConfirmProvider cancellation promise as false on browser Back', async () => {
    const result = vi.fn();
    const Trigger = () => {
      const { confirm } = useConfirm();
      useEffect(() => { void confirm({ title: '離開草稿？', message: '草稿尚未儲存。' }).then(result); }, [confirm]);
      return null;
    };

    render(<ConfirmProvider><Trigger /></ConfirmProvider>);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    act(() => { window.history.back(); });

    await waitFor(() => expect(result).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('closes the inner TextInput first and unlocks body scroll after all dialogs close', async () => {
    const Harness = () => {
      const [confirmOpen, setConfirmOpen] = useState(true);
      const [inputOpen, setInputOpen] = useState(true);
      return <>
        <ConfirmDialog open={confirmOpen} title="外層確認" message="請確認" onConfirm={() => setConfirmOpen(false)} onCancel={() => setConfirmOpen(false)} />
        <TextInputDialog open={inputOpen} title="內層輸入" label="名稱" value="草稿" onChange={() => undefined} onSubmit={() => setInputOpen(false)} onCancel={() => setInputOpen(false)} />
      </>;
    };

    render(<Harness />);
    expect(await screen.findByRole('dialog', { name: '內層輸入' })).toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: '外層確認' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => { window.history.back(); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '內層輸入' })).not.toBeInTheDocument());
    expect(screen.getByRole('alertdialog', { name: '外層確認' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => { window.history.back(); });
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '外層確認' })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
  });
});
