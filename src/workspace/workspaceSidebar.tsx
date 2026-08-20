import { useEffect, useMemo, useRef, useState } from "react";
import { getChildren } from "./model";
import { WorkspaceData, WorkspaceNode } from "./types";
import { WorkspaceIcon } from "./workspaceShared";

export interface TreeNodeProps {
  node: WorkspaceNode;
  data: WorkspaceData;
  expanded: Set<string>;
  depth: number;
  draggingId?: string;
  dragTargetId?: string | null;
  onToggle(id: string): void;
  onOpen(node: WorkspaceNode): void;
  onContext(node: WorkspaceNode): void;
  onDragPointerDown(node: WorkspaceNode, event: React.PointerEvent<HTMLDivElement>): void;
  shouldSuppressClick(): boolean;
  visibleNodeIds?: Set<string>;
  filterQuery?: string;
}

export const TreeNode = ({ node, data, expanded, depth, draggingId, dragTargetId, onToggle, onOpen, onContext, onDragPointerDown, shouldSuppressClick, visibleNodeIds, filterQuery }: TreeNodeProps) => {
  const children = node.type === 'folder' ? getChildren(data, node.id) : [];
  const visibleChildren = visibleNodeIds ? children.filter((child) => visibleNodeIds.has(child.id)) : children;
  const isOpen = filterQuery ? visibleChildren.length > 0 : expanded.has(node.id);
  return <div className="workspace-tree-item">
    <div data-node-id={node.id} data-node-type={node.type} className={`workspace-tree-row ${data.activeNodeId === node.id ? 'active' : ''} ${draggingId === node.id ? 'is-dragging' : ''} ${dragTargetId === node.id ? 'is-drop-target' : ''}`} style={{ '--workspace-depth': depth } as React.CSSProperties} onPointerDown={(event) => onDragPointerDown(node, event)} onContextMenu={(event) => event.preventDefault()} onClick={(event) => { if (shouldSuppressClick()) { event.preventDefault(); return; } if (node.type === 'folder') onToggle(node.id); else onOpen(node); }}>
      {node.type === 'folder' ? <span className={`workspace-tree-toggle ${isOpen ? 'open' : ''}`} aria-hidden="true"><WorkspaceIcon name="chevron" size={17} /></span> : <span className="workspace-tree-spacer" />}
      <span className="workspace-tree-name"><WorkspaceIcon name={node.type === 'folder' ? 'folder' : 'table'} size={19} /><span className="workspace-tree-name-text">{node.name}</span></span>
      <button type="button" className="workspace-tree-more" aria-label={`開啟${node.name}操作`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onContext(node); }}><WorkspaceIcon name="more" size={19} /></button>
    </div>
    {node.type === 'folder' && isOpen && <div className="workspace-tree-children">{visibleChildren.map((child) => <TreeNode key={child.id} node={child} data={data} expanded={expanded} depth={depth + 1} draggingId={draggingId} dragTargetId={dragTargetId} onToggle={onToggle} onOpen={onOpen} onContext={onContext} onDragPointerDown={onDragPointerDown} shouldSuppressClick={shouldSuppressClick} visibleNodeIds={visibleNodeIds} filterQuery={filterQuery} />)}</div>}
  </div>;
};
export const Tree = ({ data, expanded, onToggle, onOpen, onContext, onMove, onDragStateChange, filterQuery = '' }: { data: WorkspaceData; expanded: Set<string>; onToggle(id: string): void; onOpen(node: WorkspaceNode): void; onContext(node: WorkspaceNode): void; onMove(node: WorkspaceNode, parentId: string | null): void; onDragStateChange?(active: boolean): void; filterQuery?: string }) => {
  const treeRef = useRef<HTMLDivElement>(null);
  const autoScrollFrame = useRef<number | undefined>(undefined);
  const autoScrollVelocity = useRef(0);
  const dragSession = useRef<{ node: WorkspaceNode; pointerId: number; startX: number; startY: number; timer?: number; active: boolean } | undefined>(undefined);
  const dragTargetRef = useRef<string | null>(null);
  const suppressNextClick = useRef(false);
  const [draggingNode, setDraggingNode] = useState<WorkspaceNode>();
  const [dragTargetId, setDragTargetId] = useState<string | null>();
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const visibleNodeIds = useMemo(() => {
    const query = filterQuery.trim().toLocaleLowerCase();
    if (!query) return undefined;
    const visible = new Set<string>();
    const includeDescendants = (nodeId: string) => {
      for (const child of getChildren(data, nodeId)) {
        visible.add(child.id);
        if (child.type === 'folder') includeDescendants(child.id);
      }
    };
    const visit = (node: WorkspaceNode): boolean => {
      const matched = node.name.toLocaleLowerCase().includes(query);
      const childMatched = node.type === 'folder' && getChildren(data, node.id).some(visit);
      if (matched) {
        visible.add(node.id);
        if (node.type === 'folder') includeDescendants(node.id);
      } else if (childMatched) {
        visible.add(node.id);
      }
      return matched || childMatched;
    };
    getChildren(data, null).forEach(visit);
    return visible;
  }, [data, filterQuery]);
  const normalizedFilterQuery = filterQuery.trim();
  const stopAutoScroll = () => {
    autoScrollVelocity.current = 0;
    if (autoScrollFrame.current !== undefined) window.cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = undefined;
  };
  const runAutoScroll = () => {
    const tree = treeRef.current;
    if (!tree || autoScrollVelocity.current === 0) { autoScrollFrame.current = undefined; return; }
    const next = Math.max(0, Math.min(tree.scrollHeight - tree.clientHeight, tree.scrollTop + autoScrollVelocity.current));
    tree.scrollTop = next;
    autoScrollFrame.current = window.requestAnimationFrame(runAutoScroll);
  };
  const updateAutoScroll = (clientY: number) => {
    const tree = treeRef.current;
    if (!tree) return;
    const rect = tree.getBoundingClientRect();
    const edge = Math.min(64, rect.height / 3);
    const velocity = clientY < rect.top + edge
      ? -Math.max(3, (rect.top + edge - clientY) / 3)
      : clientY > rect.bottom - edge
        ? Math.max(3, (clientY - (rect.bottom - edge)) / 3)
        : 0;
    autoScrollVelocity.current = velocity;
    if (velocity === 0) stopAutoScroll();
    else if (autoScrollFrame.current === undefined) autoScrollFrame.current = window.requestAnimationFrame(runAutoScroll);
  };
  const isInsideNode = (candidateId: string, ancestorId: string) => {
    let current = data.nodes.find((item) => item.id === candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = data.nodes.find((item) => item.id === current?.parentId);
    }
    return false;
  };
  const clearDrag = () => {
    const session = dragSession.current;
    if (session?.timer) window.clearTimeout(session.timer);
    if (session?.active) onDragStateChange?.(false);
    stopAutoScroll();
    dragSession.current = undefined;
    dragTargetRef.current = null;
    setDraggingNode(undefined);
    setDragTargetId(undefined);
  };
  useEffect(() => () => {
    if (dragSession.current?.timer) window.clearTimeout(dragSession.current.timer);
    if (dragSession.current?.active) onDragStateChange?.(false);
    stopAutoScroll();
  }, []);
  const beginDrag = (node: WorkspaceNode, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const session = { node, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, timer: undefined as number | undefined };
    session.timer = window.setTimeout(() => {
      session.active = true;
      onDragStateChange?.(true);
      suppressNextClick.current = true;
      setDraggingNode(node);
      setDragPoint({ x: session.startX, y: session.startY });
      try { treeRef.current?.setPointerCapture(session.pointerId); } catch { /* The pointer may have ended before the long press. */ }
    }, 460);
    dragSession.current = session;
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.active) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 8) clearDrag();
      return;
    }
    event.preventDefault();
    setDragPoint({ x: event.clientX, y: event.clientY });
    updateAutoScroll(event.clientY);
    const targetRow = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>('.workspace-tree-row[data-node-id]');
    const targetId = targetRow?.dataset.nodeType === 'folder' ? targetRow.dataset.nodeId : undefined;
    const nextTarget = targetId && targetId !== session.node.id && !isInsideNode(targetId, session.node.id) ? targetId : null;
    dragTargetRef.current = nextTarget;
    setDragTargetId(nextTarget);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.active) onMove(session.node, dragTargetRef.current);
    try { if (treeRef.current?.hasPointerCapture(event.pointerId)) treeRef.current.releasePointerCapture(event.pointerId); } catch { /* Pointer capture may already be released. */ }
    clearDrag();
  };
  const shouldSuppressClick = () => {
    if (!suppressNextClick.current) return false;
    suppressNextClick.current = false;
    return true;
  };
  const rootNodes = getChildren(data, null).filter((node) => !visibleNodeIds || visibleNodeIds.has(node.id));
  return <div ref={treeRef} className={`workspace-tree ${draggingNode && dragTargetId === null ? 'is-root-drop-target' : ''}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    {rootNodes.map((node) => <TreeNode key={node.id} node={node} data={data} expanded={expanded} depth={0} draggingId={draggingNode?.id} dragTargetId={dragTargetId} onToggle={onToggle} onOpen={onOpen} onContext={onContext} onDragPointerDown={beginDrag} shouldSuppressClick={shouldSuppressClick} visibleNodeIds={visibleNodeIds} filterQuery={normalizedFilterQuery} />)}
    {!rootNodes.length && <p className="workspace-tree-empty">{normalizedFilterQuery ? '找不到符合的表格或資料夾' : '尚未建立資料夾或表格'}</p>}
    {draggingNode && <div className="workspace-drag-ghost" style={{ transform: `translate(${dragPoint.x + 12}px, ${dragPoint.y + 12}px)` }}><WorkspaceIcon name={draggingNode.type === 'folder' ? 'folder' : 'table'} size={18} />{draggingNode.name}</div>}
  </div>;
};
