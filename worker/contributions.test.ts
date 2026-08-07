import { describe, expect, test, vi } from 'vitest';
import type { SessionUser } from '../src/shared/types';
import type { Database, DatabaseStatement } from './data/database';
import {
  GAME_CONTRIBUTION_LIMIT,
  RULE_CONTRIBUTION_LIMIT,
  canEditContributionGame,
  canEditContributionRule,
  canRestoreHiddenContributionRule,
  contributionErrorCode,
  initialReviewStatus,
  isTrustedEditor,
  queryContributionQuota,
} from './contributions';

const user = (id: string, roles: SessionUser['roles']): SessionUser => ({ id, roles });

const statement = (first: unknown): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn().mockResolvedValue(first),
  all: vi.fn(),
  run: vi.fn(),
});

describe('contribution policy helpers', () => {
  test('marks editor and admin content as trusted at creation', () => {
    expect(isTrustedEditor(user('ordinary', []))).toBe(false);
    expect(isTrustedEditor(user('editor', ['editor']))).toBe(true);
    expect(isTrustedEditor(user('admin', ['admin']))).toBe(true);
    expect(initialReviewStatus(user('ordinary', []))).toBe('pending');
    expect(initialReviewStatus(user('editor', ['editor']))).toBe('not_required');
    expect(initialReviewStatus(user('admin', ['admin']))).toBe('not_required');
  });

  test('enforces the rule ownership matrix in the Worker policy', () => {
    const ordinary = user('ordinary', []);
    const editor = user('editor', ['editor']);
    const admin = user('admin', ['admin']);
    expect(canEditContributionRule({ created_by: ordinary.id, review_status: 'pending', status: 'published' }, ordinary)).toBe(true);
    expect(canEditContributionRule({ created_by: 'another-ordinary', pending_review_by: ordinary.id, review_status: 'pending', status: 'published' }, ordinary)).toBe(false);
    expect(canEditContributionRule({ created_by: ordinary.id, review_status: 'reviewed', status: 'published' }, ordinary)).toBe(false);
    expect(canEditContributionRule({ created_by: ordinary.id, review_status: 'pending', status: 'hidden' }, ordinary)).toBe(false);
    expect(canEditContributionRule({ created_by: ordinary.id, review_status: 'reviewed' }, editor)).toBe(true);
    expect(canEditContributionRule({ created_by: 'other-editor', review_status: 'not_required' }, editor)).toBe(false);
    expect(canEditContributionRule({ created_by: null, review_status: 'not_required' }, admin)).toBe(true);
  });

  test('applies the same ownership boundary to pending games', () => {
    const ordinary = user('ordinary', []);
    const editor = user('editor', ['editor']);
    expect(canEditContributionGame({ created_by: ordinary.id, review_status: 'pending', visibility: 'public' }, ordinary)).toBe(true);
    expect(canEditContributionGame({ created_by: ordinary.id, review_status: 'reviewed', visibility: 'public' }, ordinary)).toBe(false);
    expect(canEditContributionGame({ created_by: ordinary.id, review_status: 'pending', visibility: 'hidden' }, ordinary)).toBe(false);
    expect(canEditContributionGame({ created_by: ordinary.id, review_status: 'reviewed' }, editor)).toBe(true);
    expect(canEditContributionGame({ created_by: 'other-editor', review_status: 'not_required' }, editor)).toBe(false);
  });

  test('lets only the user who hid their own rule restore it', () => {
    const ordinary = user('ordinary', []);
    const editor = user('editor', ['editor']);
    const hiddenByOrdinary = { created_by: ordinary.id, hidden_by: ordinary.id, review_status: 'pending' as const, status: 'hidden' };
    expect(canRestoreHiddenContributionRule(hiddenByOrdinary, ordinary)).toBe(true);
    expect(canRestoreHiddenContributionRule({ ...hiddenByOrdinary, hidden_by: 'another-user' }, ordinary)).toBe(false);
    expect(canRestoreHiddenContributionRule(hiddenByOrdinary, editor)).toBe(true);
  });

  test('calculates remaining quota from visible, unreviewed rows only', async () => {
    const ruleStatement = statement({ count: 4 });
    const gameStatement = statement({ count: 1 });
    const db = { statement: vi.fn().mockReturnValueOnce(ruleStatement).mockReturnValueOnce(gameStatement) } as unknown as Database;

    await expect(queryContributionQuota(db, 'ordinary')).resolves.toEqual({
      pendingRules: 4, ruleLimit: RULE_CONTRIBUTION_LIMIT, remainingRules: 2,
      pendingGames: 1, gameLimit: GAME_CONTRIBUTION_LIMIT, remainingGames: 0,
    });
    expect(ruleStatement.bind).toHaveBeenCalledWith('ordinary', 'ordinary');
    expect(gameStatement.bind).toHaveBeenCalledWith('ordinary');
  });

  test('never exposes a negative remaining quota and recognizes trigger errors', async () => {
    const db = {
      statement: vi.fn()
        .mockReturnValueOnce(statement({ count: 9 }))
        .mockReturnValueOnce(statement({ count: 2 })),
    } as unknown as Database;
    await expect(queryContributionQuota(db, 'ordinary')).resolves.toMatchObject({ remainingRules: 0, remainingGames: 0 });
    expect(contributionErrorCode(new Error('D1_ERROR: pending_rule_limit'))).toBe('PENDING_RULE_LIMIT_REACHED');
    expect(contributionErrorCode(new Error('pending_game_limit'))).toBe('PENDING_GAME_LIMIT_REACHED');
    expect(contributionErrorCode(new Error('unrelated failure'))).toBeUndefined();
  });
});
