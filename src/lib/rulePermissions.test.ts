import { describe, expect, it } from 'vitest';
import { canUserEditRule } from './rulePermissions';
import type { RuleCard, SessionUser } from '../shared/types';

const rule = (createdBy?: string): RuleCard => ({
  id: 'rule-1',
  gameId: 'game-1',
  statement: 'Test rule',
  sourceLinks: [],
  status: 'published',
  createdBy,
  tags: [],
});

const user = (id: string, roles: SessionUser['roles']): SessionUser => ({
  id,
  email: `${id}@example.com`,
  roles,
});

describe('canUserEditRule', () => {
  it('allows an admin to edit any rule', () => {
    expect(canUserEditRule(rule('another-user'), user('admin', ['admin']), true)).toBe(true);
  });

  it('allows an editor to edit their own rule', () => {
    expect(canUserEditRule(rule('editor-1'), user('editor-1', ['editor']), false)).toBe(true);
  });

  it('rejects an editor editing another user rule', () => {
    expect(canUserEditRule(rule('editor-2'), user('editor-1', ['editor']), false)).toBe(false);
  });

  it('rejects rules without a creator for non-admin users', () => {
    expect(canUserEditRule(rule(), user('editor-1', ['editor']), false)).toBe(false);
  });
});
