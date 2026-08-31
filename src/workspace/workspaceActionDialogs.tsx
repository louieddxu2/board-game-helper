import { WorkspaceData, WorkspaceNode } from "./types";
import { WorkspaceIcon, WorkspaceModal } from "./workspaceShared";

export const NodeActionsDialog = ({ node, onClose, onRename, onDelete, onAddFolder, onAddTable, onMove, onToggleBottomNav, isInBottomNav }: { node: WorkspaceNode; onClose(): void; onRename(): void; onDelete(): void; onAddFolder(): void; onAddTable(): void; onMove(): void; onToggleBottomNav?(): void; isInBottomNav?: boolean }) => <WorkspaceModal title={node.name} onClose={onClose} className="workspace-action-dialog" leadingAction={<button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
  <div className="workspace-action-list">
    {node.type === 'folder' && <><button type="button" onClick={onAddTable}><WorkspaceIcon name="table" size={21} />在此新增表格</button><button type="button" onClick={onAddFolder}><WorkspaceIcon name="folder" size={21} />在此新增資料夾</button></>}
    <button type="button" onClick={onRename}><WorkspaceIcon name="edit" size={21} />重新命名</button>
    <button type="button" onClick={onMove}><WorkspaceIcon name="move" size={21} />移動至</button>
    {node.type === 'table' && onToggleBottomNav && <button type="button" onClick={onToggleBottomNav}><WorkspaceIcon name="bottom-navigation" size={21} />{isInBottomNav ? '從底部導覽列移除' : '加入底部導覽列'}</button>}
  </div>
</WorkspaceModal>;
export const MoveNodeDialog = ({ node, data, onClose, onMove }: { node: WorkspaceNode; data: WorkspaceData; onClose(): void; onMove(parentId: string | null): void }) => {
  const invalidFolders = new Set<string>([node.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of data.nodes) if (item.parentId && invalidFolders.has(item.parentId) && !invalidFolders.has(item.id)) { invalidFolders.add(item.id); changed = true; }
  }
  const folders = data.nodes.filter((item) => item.type === 'folder' && !invalidFolders.has(item.id));
  return <WorkspaceModal title={`移動「${node.name}」`} onClose={onClose} className="workspace-action-dialog"><div className="workspace-action-list workspace-move-list"><button type="button" onClick={() => onMove(null)}><WorkspaceIcon name="home" size={21} />最外層</button>{folders.map((folder) => <button type="button" key={folder.id} onClick={() => onMove(folder.id)}><WorkspaceIcon name="folder" size={21} />{folder.name}</button>)}</div></WorkspaceModal>;
};
export const TableActionsDialog = ({ tableName, transposed, onClose, onExport, onTranspose }: { tableName: string; transposed: boolean; onClose(): void; onExport(): void; onTranspose(): void }) => <WorkspaceModal title={tableName} onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    <button type="button" onClick={onTranspose}><WorkspaceIcon name="refresh" size={21} />{transposed ? '恢復正常顯示' : '轉置顯示'}</button>
    <button type="button" onClick={onExport}><WorkspaceIcon name="download" size={21} />匯出此表</button>
  </div>
</WorkspaceModal>;
export const TableAddDialog = ({ onClose, onAddRow, onAddColumn }: { onClose(): void; onAddRow(): void; onAddColumn(): void }) => <WorkspaceModal title="新增" onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    <button type="button" onClick={onAddRow}><WorkspaceIcon name="rows" size={21} />物件</button>
    <button type="button" onClick={onAddColumn}><WorkspaceIcon name="columns" size={21} />屬性</button>
  </div>
</WorkspaceModal>;
export const TableCreateDialog = ({ onClose, onCreate, onImport }: { onClose(): void; onCreate(): void; onImport(): void }) => <WorkspaceModal title="新增表格" onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    <button type="button" onClick={onCreate}><WorkspaceIcon name="table-plus" size={21} />建立空白表格</button>
    <button type="button" onClick={onImport}><WorkspaceIcon name="upload" size={21} />匯入單表</button>
  </div>
</WorkspaceModal>;
