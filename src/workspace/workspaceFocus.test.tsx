import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceInputModalityContext, WorkspaceModal, useWorkspaceInputModality } from './workspaceShared';

afterEach(() => cleanup());

const afterFocusRestoration = () => act(async () => {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
});

describe('workspace dialog focus ownership', () => {
  it('does not restore focus to an unrelated pointer action before a delayed dialog opens', async () => {
    const Harness = () => {
      const inputModality = useWorkspaceInputModality();
      const [open, setOpen] = useState(false);
      useEffect(() => {
        const timer = window.setTimeout(() => setOpen(true), 20);
        return () => window.clearTimeout(timer);
      }, []);
      return <WorkspaceInputModalityContext.Provider value={inputModality}>
        <section className="workspace-page" tabIndex={-1}>
          <button type="button">Unrelated action</button>
          {open && <WorkspaceModal title="Delayed dialog" onClose={() => setOpen(false)}><p>Content</p></WorkspaceModal>}
        </section>
      </WorkspaceInputModalityContext.Provider>;
    };
    render(<Harness />);
    const unrelated = screen.getByRole('button', { name: 'Unrelated action' });
    fireEvent.pointerDown(unrelated);
    fireEvent.click(unrelated);
    expect(await screen.findByRole('dialog', { name: 'Delayed dialog' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await afterFocusRestoration();
    expect(unrelated).not.toHaveFocus();
  });

  it('does not use a stale keyboard focus as the opener of a background dialog', async () => {
    const Harness = () => {
      const inputModality = useWorkspaceInputModality();
      const [open, setOpen] = useState(false);
      useEffect(() => {
        const timer = window.setTimeout(() => setOpen(true), 20);
        return () => window.clearTimeout(timer);
      }, []);
      return <WorkspaceInputModalityContext.Provider value={inputModality}>
        <section className="workspace-page" tabIndex={-1} aria-label="Workspace surface">
          <button type="button">Unrelated action</button>
          {open && <WorkspaceModal title="Background dialog" onClose={() => setOpen(false)}><input aria-label="Value" /></WorkspaceModal>}
        </section>
      </WorkspaceInputModalityContext.Provider>;
    };
    render(<Harness />);
    const unrelated = screen.getByRole('button', { name: 'Unrelated action' });
    unrelated.focus();
    fireEvent.keyDown(unrelated, { key: 'k' });
    expect(await screen.findByRole('dialog', { name: 'Background dialog' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await afterFocusRestoration();
    expect(unrelated).not.toHaveFocus();
    expect(screen.getByLabelText('Workspace surface')).toHaveFocus();
  });

  it('uses the workspace surface when a keyboard opener disappears before the dialog closes', async () => {
    const Harness = () => {
      const inputModality = useWorkspaceInputModality();
      const [open, setOpen] = useState(false);
      const [showOpener, setShowOpener] = useState(true);
      return <WorkspaceInputModalityContext.Provider value={inputModality}>
        <section className="workspace-page" tabIndex={-1} aria-label="Workspace surface">
          <button type="button">Unrelated action</button>
          {showOpener && <button type="button" onClick={() => setOpen(true)}>Open dialog</button>}
          {open && <WorkspaceModal title="Editor" onClose={() => { setOpen(false); setShowOpener(false); }}><input aria-label="Value" /></WorkspaceModal>}
        </section>
      </WorkspaceInputModalityContext.Provider>;
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'Enter' });
    fireEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await afterFocusRestoration();
    expect(screen.getByLabelText('Workspace surface')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Unrelated action' })).not.toHaveFocus();
  });

  it('keeps focus in the remaining dialog when the top dialog closes', async () => {
    const Harness = () => {
      const [showTop, setShowTop] = useState(true);
      return <section className="workspace-page" tabIndex={-1}>
        <WorkspaceModal title="Lower dialog" onClose={() => undefined}><button type="button">Lower action</button></WorkspaceModal>
        {showTop && <WorkspaceModal title="Top dialog" onClose={() => setShowTop(false)}><input aria-label="Top value" /></WorkspaceModal>}
      </section>;
    };
    render(<Harness />);
    expect(screen.getByRole('textbox', { name: 'Top value' })).toHaveFocus();
    fireEvent.click(screen.getAllByRole('button', { name: '關閉' })[1]);
    await afterFocusRestoration();
    expect(screen.getByRole('dialog', { name: 'Lower dialog' })).toContainElement(document.activeElement as HTMLElement);
  });

  it('returns through the dialog opener when an action dialog is replaced by an editor', async () => {
    const Harness = () => {
      const inputModality = useWorkspaceInputModality();
      const [stage, setStage] = useState<'actions' | 'editor' | null>(null);
      return <WorkspaceInputModalityContext.Provider value={inputModality}>
        <section className="workspace-page" tabIndex={-1}>
          <button type="button" onClick={() => setStage('actions')}>Open actions</button>
          {stage === 'actions' && <WorkspaceModal title="Actions" onClose={() => setStage(null)}><button type="button" onClick={() => setStage('editor')}>Rename</button></WorkspaceModal>}
          {stage === 'editor' && <WorkspaceModal title="Editor" onClose={() => setStage(null)}><input aria-label="New name" /></WorkspaceModal>}
        </section>
      </WorkspaceInputModalityContext.Provider>;
    };
    render(<Harness />);
    const outerOpener = screen.getByRole('button', { name: 'Open actions' });
    outerOpener.focus();
    fireEvent.keyDown(outerOpener, { key: 'Enter' });
    fireEvent.click(outerOpener);
    const rename = screen.getByRole('button', { name: 'Rename' });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(rename, { key: 'Enter' });
    fireEvent.click(rename);
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await afterFocusRestoration();
    expect(outerOpener).toHaveFocus();
  });

  it('keeps pointer-restored focus unobtrusive inside a remaining dialog', async () => {
    const Harness = () => {
      const inputModality = useWorkspaceInputModality();
      const [showTop, setShowTop] = useState(false);
      return <WorkspaceInputModalityContext.Provider value={inputModality}>
        <section className="workspace-page" tabIndex={-1}>
          <WorkspaceModal title="Lower dialog" onClose={() => undefined}><button type="button" onClick={() => setShowTop(true)}>Open editor</button></WorkspaceModal>
          {showTop && <WorkspaceModal title="Top dialog" onClose={() => setShowTop(false)}><input aria-label="Top value" /></WorkspaceModal>}
        </section>
      </WorkspaceInputModalityContext.Provider>;
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open editor' });
    fireEvent.pointerDown(opener);
    fireEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Top value' })).toHaveFocus();
    const close = screen.getAllByRole('button', { name: '關閉' })[1];
    fireEvent.pointerDown(close);
    fireEvent.click(close);
    await afterFocusRestoration();
    expect(opener).toHaveFocus();
    expect(opener).toHaveClass('workspace-restored-pointer-focus');
  });

  it('does not move focus into a different workspace after navigation', async () => {
    const OldPage = () => {
      const inputModality = useWorkspaceInputModality();
      const [open, setOpen] = useState(false);
      return <WorkspaceInputModalityContext.Provider value={inputModality}>
        <section className="workspace-page" tabIndex={-1}>
          <button type="button" onClick={() => setOpen(true)}>Old opener</button>
          {open && <WorkspaceModal title="Old dialog" onClose={() => setOpen(false)}><input aria-label="Old value" /></WorkspaceModal>}
        </section>
      </WorkspaceInputModalityContext.Provider>;
    };
    const oldPage = render(<OldPage />);
    const opener = screen.getByRole('button', { name: 'Old opener' });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'Enter' });
    fireEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Old value' })).toHaveFocus();
    oldPage.unmount();
    render(<section className="workspace-page" tabIndex={-1}><button type="button">New page action</button></section>);
    await afterFocusRestoration();
    expect(screen.getByRole('button', { name: 'New page action' })).not.toHaveFocus();
  });
});
