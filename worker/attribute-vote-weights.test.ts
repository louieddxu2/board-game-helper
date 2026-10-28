import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
  ATTRIBUTE_VOTE_WEIGHTS,
  attributeVoteWeight,
  queryAuthorizedAttributeVoters,
  requireAttributeReplayAfterChange,
} from './data/attributeVoteWeights';

describe('attribute vote weights', () => {
  test('keeps guest, member, and authorized editor/admin weights distinct', () => {
    expect(attributeVoteWeight(null)).toBe(ATTRIBUTE_VOTE_WEIGHTS.guest);
    expect(attributeVoteWeight('member-1')).toBe(ATTRIBUTE_VOTE_WEIGHTS.member);
    expect(attributeVoteWeight('editor-1', true)).toBe(ATTRIBUTE_VOTE_WEIGHTS.editor);
    expect(attributeVoteWeight('admin-1', true)).toBe(ATTRIBUTE_VOTE_WEIGHTS.editor);
  });

  test('treats an empty actor id as anonymous even when authorization is claimed', () => {
    expect(attributeVoteWeight('', true)).toBe(ATTRIBUTE_VOTE_WEIGHTS.guest);
    expect(attributeVoteWeight(undefined, true)).toBe(ATTRIBUTE_VOTE_WEIGHTS.guest);
  });

  test('loads active admin/editor ids with one role query', async () => {
    const statement: DatabaseStatement = {
      bind: vi.fn(function (this: DatabaseStatement) { return this; }),
      first: vi.fn(),
      all: vi.fn().mockResolvedValue({ results: [{ user_id: 'editor-1' }, { user_id: 'admin-1' }] }),
      run: vi.fn(),
    };
    const db = { statement: vi.fn().mockReturnValue(statement) } as unknown as Database;

    await expect(queryAuthorizedAttributeVoters(db)).resolves.toEqual(new Set(['editor-1', 'admin-1']));
    expect(db.statement).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.statement).mock.calls[0][0]).toMatch(/role IN \(\?, \?\)/);
    expect(vi.mocked(db.statement).mock.calls[0][0]).toMatch(/revoked_at\s+IS\s+NULL/);
    expect(statement.bind).toHaveBeenCalledWith('admin', 'editor');
  });

  test('marks replay only when the immediately preceding mutation changed a row', () => {
    const db = { statement: vi.fn((sql: string) => ({ sql })) } as unknown as Database;
    const statement = requireAttributeReplayAfterChange(db) as unknown as { sql: string };

    expect(statement.sql).toMatch(/UPDATE\s+attribute_replay_status/i);
    expect(statement.sql).toMatch(/WHERE\s+id\s*=\s*1\s+AND\s+changes\(\)\s*>\s*0/i);
  });
});
