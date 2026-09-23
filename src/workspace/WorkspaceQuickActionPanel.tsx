import { WorkspaceIcon } from './workspaceShared';

type WorkspaceQuickActionPanelProps = {
  expanded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoTitle: string;
  redoTitle: string;
  onExpand(): void;
  onCollapse(): void;
  onAddRow(): void;
  onUndo(): void;
  onRedo(): void;
  onAddColumn(): void;
};

export const WorkspaceQuickActionPanel = ({
  expanded,
  canUndo,
  canRedo,
  undoTitle,
  redoTitle,
  onExpand,
  onCollapse,
  onAddRow,
  onUndo,
  onRedo,
  onAddColumn,
}: WorkspaceQuickActionPanelProps) => <div className={`workspace-quick-actions${expanded ? ' is-expanded' : ''}`}>
  {expanded ? <>
    <button type="button" className="workspace-quick-actions-collapse" aria-label="收合快速操作" aria-expanded="true" onClick={onCollapse}><WorkspaceIcon name="down" size={18} /></button>
    <div className="workspace-quick-actions-controls" role="toolbar" aria-label="快速操作">
      <button type="button" className="workspace-quick-action" aria-label="新增列" onClick={onAddRow}><WorkspaceIcon name="rows-plus" size={21} /><span>新增列</span></button>
      <button type="button" className="workspace-quick-action" aria-label="上一動" title={undoTitle} onClick={onUndo} disabled={!canUndo}><WorkspaceIcon name="undo" size={20} /><span>上一動</span></button>
      <button type="button" className="workspace-quick-action" aria-label="下一動" title={redoTitle} onClick={onRedo} disabled={!canRedo}><WorkspaceIcon name="redo" size={20} /><span>下一動</span></button>
      <button type="button" className="workspace-quick-action" aria-label="新增欄" onClick={onAddColumn}><WorkspaceIcon name="columns-plus" size={21} /><span>新增欄</span></button>
    </div>
  </> : <button type="button" className="workspace-quick-actions-collapsed" aria-label="展開快速操作" aria-expanded="false" onClick={onExpand}>
    <span className="workspace-quick-actions-preview" aria-hidden="true">
      <span><WorkspaceIcon name="rows-plus" size={15} />列</span>
      <span><WorkspaceIcon name="undo" size={14} />上一動</span>
      <span><WorkspaceIcon name="redo" size={14} />下一動</span>
      <span><WorkspaceIcon name="columns-plus" size={15} />欄</span>
    </span>
    <WorkspaceIcon name="up" size={17} />
  </button>}
</div>;
