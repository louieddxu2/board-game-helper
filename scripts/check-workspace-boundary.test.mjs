// @vitest-environment node
import { afterEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditWorkspaceBoundary } from './check-workspace-boundary.mjs';

const roots = [];
const base = path.resolve(tmpdir());
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(`${base}${path.sep}`) || !path.basename(root).startsWith('workspace-boundary-')) throw new Error('Unexpected test cleanup path');
    rmSync(root, { recursive: true, force: true });
  }
});
const fixture = extra => {
  const root = mkdtempSync(path.join(base, 'workspace-boundary-')); roots.push(root);
  const files = { 'src/pages/WorkspacePage.tsx': "import '../workspace/feature';", 'src/workspace/feature.ts': 'export const local = 1;', ...extra };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
  }
  return root;
};

test('allows local modules and only the database-independent public OAuth configuration', () => {
  const root = fixture({ 'src/workspace/googleDriveBackup/workspaceConfig.ts': "export const load = () => fetch('/api/workspace-config', {credentials:'omit'});" });
  expect(auditWorkspaceBoundary(root)).toEqual([]);
});

test.each(["import '../lib/api';", "export * from '../lib/api';", "void import('../lib/api');", "require('../lib/api');"])
  ('rejects a website API dependency hidden behind shared helpers: %s', reference => {
    const root = fixture({ 'src/workspace/feature.ts': "import '../shared/helper';", 'src/shared/helper.ts': reference,
      'src/lib/api.ts': 'export const api = {};' });
    expect(auditWorkspaceBoundary(root)).toEqual(expect.arrayContaining([expect.stringContaining('src/lib/api.ts')]));
  });

test('rejects site sessions, D1 types, and direct site data requests anywhere in Workspace', () => {
  const root = fixture({ 'src/workspace/feature.ts': "import '../context/SessionContext'; interface D1Database {}; fetch('/api/session');",
    'src/context/SessionContext.tsx': 'export const SessionProvider = null;' });
  const violations = auditWorkspaceBoundary(root).join('\n');
  expect(violations).toContain('SessionContext'); expect(violations).toContain('D1 types'); expect(violations).toContain('/api/session');
});
