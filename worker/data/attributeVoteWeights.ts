import type { Database } from './database';

export const ATTRIBUTE_VOTE_WEIGHTS = { guest: 1, member: 1.5, editor: 2 } as const;

export const attributeVoteWeight = (actorId: string | null | undefined, authorized = false): number =>
  !actorId ? ATTRIBUTE_VOTE_WEIGHTS.guest : authorized ? ATTRIBUTE_VOTE_WEIGHTS.editor : ATTRIBUTE_VOTE_WEIGHTS.member;

export const queryAuthorizedAttributeVoters = async (db: Database): Promise<Set<string>> => {
  const result = await db.statement(`
    SELECT user_id FROM user_roles
    WHERE role IN (?, ?) AND revoked_at IS NULL
  `).bind('admin', 'editor').all<{ user_id: string }>();
  return new Set((result.results ?? []).map((row) => row.user_id));
};

// Append immediately after the role mutation in the same transaction. This
// marks only the one global status row and never visits the vote history.
export const requireAttributeReplayAfterChange = (db: Database) => db.statement(`
  UPDATE attribute_replay_status SET required_revision = required_revision + 1
  WHERE id = 1 AND changes() > 0
`);
