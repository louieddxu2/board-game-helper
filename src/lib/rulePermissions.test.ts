import { describe, expect, it } from 'vitest';
import { canUserEditRule, canUserReviewRule } from './rulePermissions';
import type { ContributionReviewStatus, RuleCard, SessionUser } from '../shared/types';

const rule = (
  createdBy: string | undefined,
  reviewStatus: ContributionReviewStatus,
  status: RuleCard['status'] = 'published',
): RuleCard => ({
  id: 'rule-1', gameId: 'game-1', statement: 'Test rule', sourceLinks: [], status,
  createdBy, reviewStatus, tags: [],
});

const user = (id: string, roles: SessionUser['roles']): SessionUser => ({
  id, maskedEmail: `${id[0]}***@example.com`, roles,
});

describe('contribution rule permissions', () => {
  const ordinary = user('ordinary-1', []);
  const anotherOrdinary = user('ordinary-2', []);
  const editor = user('editor-1', ['editor']);
  const anotherEditor = user('editor-2', ['editor']);
  const admin = user('admin-1', ['admin']);

  it('lets an ordinary contributor edit only their own visible pending rule', () => {
    expect(canUserEditRule(rule(ordinary.id, 'pending'), ordinary, false)).toBe(true);
    expect(canUserEditRule(rule(ordinary.id, 'reviewed'), ordinary, false)).toBe(false);
    expect(canUserEditRule(rule(ordinary.id, 'not_required'), ordinary, false)).toBe(false);
    expect(canUserEditRule(rule(anotherOrdinary.id, 'pending'), ordinary, false)).toBe(false);
    expect(canUserEditRule(rule(ordinary.id, 'pending', 'hidden'), ordinary, false)).toBe(false);
  });

  it('lets an editor edit their own trusted rule and every general-user contribution', () => {
    expect(canUserEditRule(rule(editor.id, 'not_required'), editor, false)).toBe(true);
    expect(canUserEditRule(rule(ordinary.id, 'pending'), editor, false)).toBe(true);
    expect(canUserEditRule(rule(ordinary.id, 'reviewed'), editor, false)).toBe(true);
  });

  it('does not let an editor change another editor’s trusted rule', () => {
    expect(canUserEditRule(rule(anotherEditor.id, 'not_required'), editor, false)).toBe(false);
    expect(canUserEditRule(rule(undefined, 'not_required'), editor, false)).toBe(false);
  });

  it('lets an admin edit every rule regardless of author or review state', () => {
    for (const state of ['not_required', 'pending', 'reviewed'] as const) {
      expect(canUserEditRule(rule(undefined, state), admin, true)).toBe(true);
    }
  });

  it('allows only editors and admins to review pending contributions', () => {
    expect(canUserReviewRule(rule(ordinary.id, 'pending'), ordinary)).toBe(false);
    expect(canUserReviewRule(rule(ordinary.id, 'pending'), editor)).toBe(true);
    expect(canUserReviewRule(rule(ordinary.id, 'pending'), admin)).toBe(true);
    expect(canUserReviewRule(rule(ordinary.id, 'reviewed'), editor)).toBe(false);
    expect(canUserReviewRule(rule(editor.id, 'not_required'), admin)).toBe(false);
    expect(canUserReviewRule(rule(ordinary.id, 'pending'), null)).toBe(false);
  });
});
