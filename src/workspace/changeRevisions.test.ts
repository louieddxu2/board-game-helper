import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { applyWorkspaceTableHistoryAction } from './history';
import { createNode, createTable, emptyWorkspace } from './model';
import { assignWorkspaceChangeRevisions, workspaceStructureChangeRevision, workspaceTableChangeRevision } from './changeRevisions';
import type { WorkspaceData } from './types';

const makeData = (): WorkspaceData => {
  const first = { ...createTable('表格 A'), changeRevision: 'table-a', updatedAt: 100 };
  const second = { ...createTable('表格 B'), changeRevision: 'table-b', updatedAt: 100 };
  const firstNode = createNode('table', first.name, null, 0, first.id);
  const secondNode = createNode('table', second.name, null, 1, second.id);
  return {
    ...emptyWorkspace(),
    updatedAt: 100,
    structureRevision: 'structure-a',
    nodes: [firstNode, secondNode],
    tables: [first, second],
    activeNodeId: firstNode.id,
  };
};

describe('workspace change revisions', () => {
  let generatedUuid = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    generatedUuid = 0;
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${++generatedUuid}`),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('assigns fresh revisions for an edit, undo, and import in the same millisecond', () => {
    const base = makeData();
    const action = { type: 'set-cell' as const, rowId: base.tables[0].rows[0].id, columnId: base.tables[0].columns[0].id, before: null, after: '編輯值' };

    const edited = assignWorkspaceChangeRevisions(base, applyWorkspaceTableHistoryAction(base, base.tables[0].id, action, 'redo'));
    const undone = assignWorkspaceChangeRevisions(edited, applyWorkspaceTableHistoryAction(edited, edited.tables[0].id, action, 'undo'));
    const imported = assignWorkspaceChangeRevisions(undone, {
      ...undone,
      tables: undone.tables.map((table, index) => index === 0 ? { ...table, name: '匯入後表格' } : table),
    });

    expect(edited.tables[0].changeRevision).not.toBe(base.tables[0].changeRevision);
    expect(undone.tables[0].changeRevision).not.toBe(edited.tables[0].changeRevision);
    expect(imported.tables[0].changeRevision).not.toBe(undone.tables[0].changeRevision);
    expect(new Set([
      edited.tables[0].changeRevision,
      undone.tables[0].changeRevision,
      imported.tables[0].changeRevision,
    ]).size).toBe(3);
    expect(edited.structureRevision).toBe(base.structureRevision);
    expect(undone.structureRevision).toBe(base.structureRevision);
    expect(imported.structureRevision).toBe(base.structureRevision);
  });

  it('changes only the edited table revision and preserves other table references', () => {
    const base = makeData();
    const next = {
      ...base,
      tables: base.tables.map((table, index) => index === 0 ? { ...table, name: '修改後' } : table),
    };

    const committed = assignWorkspaceChangeRevisions(base, next);

    expect(committed.tables[0].changeRevision).not.toBe(base.tables[0].changeRevision);
    expect(committed.tables[1]).toBe(base.tables[1]);
    expect(committed.structureRevision).toBe(base.structureRevision);
  });

  it('changes the structure revision for bottom navigation changes and node moves', () => {
    const base = makeData();
    const withBottomNavigation = assignWorkspaceChangeRevisions(base, {
      ...base,
      bottomNavigationTableIds: [base.tables[0].id],
    });
    expect(withBottomNavigation.structureRevision).not.toBe(base.structureRevision);
    expect(withBottomNavigation.tables).toEqual(base.tables);

    const folder = createNode('folder', '資料夾', null, 0);
    const moved = assignWorkspaceChangeRevisions(withBottomNavigation, {
      ...withBottomNavigation,
      nodes: [folder, ...withBottomNavigation.nodes.map((node) => node.tableId === withBottomNavigation.tables[0].id ? { ...node, parentId: folder.id } : node)],
    });
    expect(moved.structureRevision).not.toBe(withBottomNavigation.structureRevision);
    expect(moved.tables).toEqual(withBottomNavigation.tables);
  });

  it('keeps legacy fallback markers stable until the first table mutation', () => {
    const source = makeData();
    const legacy = {
      ...source,
      structureRevision: undefined,
      tables: source.tables.map((table) => ({ ...table, changeRevision: undefined })),
    };
    const copied = JSON.parse(JSON.stringify(legacy)) as WorkspaceData;
    const legacyStructureRevision = workspaceStructureChangeRevision(legacy);
    const legacyTableRevision = workspaceTableChangeRevision(legacy.tables[0]);
    const edited = assignWorkspaceChangeRevisions(legacy, {
      ...legacy,
      updatedAt: 101,
      tables: legacy.tables.map((table, index) => index === 0 ? { ...table, name: '首次修改' } : table),
    });

    expect(workspaceStructureChangeRevision(copied)).toBe(legacyStructureRevision);
    expect(workspaceTableChangeRevision(copied.tables[0])).toBe(legacyTableRevision);
    expect(workspaceStructureChangeRevision(edited)).toBe(legacyStructureRevision);
    expect(edited.tables[0].changeRevision).toBeDefined();
    expect(workspaceTableChangeRevision(edited.tables[0])).not.toBe(legacyTableRevision);
  });
});
