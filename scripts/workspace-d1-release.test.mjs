// @vitest-environment node
import { expect, test } from 'vitest';
import { app } from '../worker/index';
import { assertWorkspaceD1RemovalReady, deferWorkspaceD1Removal, WORKSPACE_D1_REMOVAL_MIGRATION } from './workspace-d1-release.mjs';

test('defers only the isolated destructive cleanup until after code deployment', () => {
  expect(deferWorkspaceD1Removal([])).toBe(false);
  expect(deferWorkspaceD1Removal(['0115_drive_snapshot_coordination.sql'])).toBe(false);
  expect(deferWorkspaceD1Removal([WORKSPACE_D1_REMOVAL_MIGRATION])).toBe(true);
  expect(() => deferWorkspaceD1Removal(['0114_conditional_attribute_replay.sql', WORKSPACE_D1_REMOVAL_MIGRATION])).toThrow('獨立發布');
});

test('accepts the actual deployed route contract even when D1 access is unavailable', async () => {
  const env = new Proxy({}, { get(_target, key) {
    if (key === 'GOOGLE_DRIVE_CLIENT_ID') return 'public-client';
    throw new Error('Workspace must not access any database/session dependency');
  } });
  const bridge = async (input, init) => app.request(String(input), init, env);
  await expect(assertWorkspaceD1RemovalReady('https://rules.test', bridge)).resolves.toBeUndefined();
});

test.each([200, 403, 500])('rejects a still-active or unavailable production backup API (%s)', async status => {
  await expect(assertWorkspaceD1RemovalReady('https://rules.test', async () => Response.json({}, { status }))).rejects.toThrow('拒絕刪除');
});

test('rejects a route that still reports database activity', async () => {
  await expect(assertWorkspaceD1RemovalReady('https://rules.test', async () => Response.json({ error: 'backup_client_update_required' }, {
    status: 410, headers: { 'x-d1-rows-read': '1' },
  }))).rejects.toThrow('拒絕刪除');
});
