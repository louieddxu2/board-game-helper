// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';

// Google signatures are not under test; the identity in the credential is.
vi.mock('jose', async (importOriginal) => ({
  ...await importOriginal<typeof import('jose')>(),
  jwtVerify: vi.fn(async (credential: string) => ({ payload: JSON.parse(credential) })),
}));

const { app } = await import('../worker');
const { DAILY_SHARED_WRITE_LIMIT, resetWriteBudgetMemoryForTests, writeBudgetDay } = await import('../worker/data/writeBudget');
const { createHarness } = await import('./attributeReplayTestHarness');

beforeEach(() => resetWriteBudgetMemoryForTests());

const setup = () => {
  const h = createHarness();
  h.sqlite.exec(`DELETE FROM attribute_vote_responses; DELETE FROM catalog_change_outbox;
    UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL;`);
  const sessions: Record<string, string> = {};
  for (const [id, role] of [['budget-member', null], ['budget-editor', 'editor'], ['budget-admin', 'admin']] as const) {
    h.sqlite.prepare(`INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at)
      VALUES(?, ?, ?, ?, 1, 1)`).run(id, `sub-${id}`, `${id}@example.invalid`, `${id}@example.invalid`);
    if (role) h.sqlite.prepare("INSERT INTO user_roles(user_id, role, granted_by, granted_at) VALUES(?, ?, ?, 1)").run(id, role, id);
    sessions[id] = `token-${id}`;
    h.sqlite.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at,last_seen_at) VALUES(?,?,1,?,1)')
      .run(createHash('sha256').update(sessions[id]).digest('hex'), id, Date.now() + 86_400_000);
  }
  const ids = h.sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
    JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
    WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 2`).all().map((row: { id: unknown }) => String(row.id));
  const env = { ...h.env, APP_ORIGIN: 'https://budget.test', EXPOSE_D1_METRICS: '1', GOOGLE_CLIENT_ID: 'budget-client', EMAIL_HASH_SECRET: 'budget-secret-for-email-hashing-tests',
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) }, WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const request = (path: string, init: RequestInit & { as?: string } = {}) => app.request(`https://budget.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', origin: 'https://budget.test',
      ...(init.as ? { cookie: `wbr_session=${sessions[init.as]}` } : {}) },
  }, env);
  let n = 0;
  const vote = (as?: string) => request('/api/attributes/responses', { method: 'POST', as, body: JSON.stringify({
    attributeId: 'attribute_setup_variability', subjectAId: ids[0], subjectBId: ids[1], comparison: 'A_HIGHER',
    responseId: `budget-response-${++n}`, sessionId: 'budget-visitor',
  }) });
  const used = () => Number((h.sqlite.prepare('SELECT rows_written FROM daily_write_budget WHERE day = ?')
    .get(writeBudgetDay(Date.now())) as { rows_written: number } | undefined)?.rows_written ?? 0);
  const spend = () => h.sqlite.prepare('INSERT OR REPLACE INTO daily_write_budget(day, rows_written, exhausted_at) VALUES(?, ?, 1)')
    .run(writeBudgetDay(Date.now()), DAILY_SHARED_WRITE_LIMIT);
  const votes = () => Number((h.sqlite.prepare('SELECT COUNT(*) n FROM attribute_vote_responses').get() as { n: number }).n);
  const login = (sub: string) => request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: JSON.stringify({
    sub, email: `${sub}@example.invalid`, email_verified: true, iss: 'https://accounts.google.com', aud: 'budget-client',
  }) }) });
  return { ...h, request, vote, used, spend, votes, login };
};

test('visitor and member writes are charged with the rows D1 reports', async () => {
  const h = setup();
  const guest = await h.vote();
  expect(guest.status).toBe(200);
  const charged = h.used();
  expect(charged).toBeGreaterThan(0);
  expect(charged).toBe(Number(guest.headers.get('X-D1-Rows-Written')));
  const member = await h.vote('budget-member');
  expect(member.status).toBe(200);
  expect(h.used()).toBe(charged + Number(member.headers.get('X-D1-Rows-Written')));
  expect((await h.request('/api/home')).status).toBe(200);
  expect(h.used()).toBe(charged + Number(member.headers.get('X-D1-Rows-Written')));
});

test('a spent budget refuses visitors and members before any write, then without reading', async () => {
  const h = setup();
  h.spend();
  const before = h.votes();
  h.executedSql.length = 0;
  const refused = await h.vote();
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual({ error: 'daily_write_budget_exhausted', resetsAt: expect.any(Number) });
  expect(h.executedSql.every((sql) => /^\s*SELECT/i.test(sql))).toBe(true);
  h.executedSql.length = 0;
  expect((await h.vote('budget-member')).status).toBe(429);
  expect(h.executedSql.some((sql) => /daily_write_budget/.test(sql))).toBe(false);
  expect(h.votes()).toBe(before);
  expect(h.used()).toBe(DAILY_SHARED_WRITE_LIMIT);
  // Reading is never limited.
  expect((await h.request('/api/home')).status).toBe(200);
});

test('editors, admins, logging out and deleting an account are never limited', async () => {
  const h = setup();
  h.spend();
  expect((await h.vote('budget-editor')).status).toBe(200);
  expect((await h.vote('budget-admin')).status).toBe(200);
  expect(h.used()).toBe(DAILY_SHARED_WRITE_LIMIT);
  expect((await h.request('/api/logout', { method: 'POST', as: 'budget-member', body: '{}' })).status).toBe(200);
  expect((await h.request('/api/account', { method: 'DELETE', as: 'budget-editor', body: '{}' })).status).not.toBe(429);
});

test('a spent budget still lets editors and admins sign in, but nobody else', async () => {
  const h = setup();
  expect((await h.login('fresh-visitor')).status).toBe(200);
  h.spend();
  resetWriteBudgetMemoryForTests();
  const refused = await h.login('another-visitor');
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual(expect.objectContaining({ error: 'daily_write_budget_exhausted' }));
  expect((await h.login('sub-budget-member')).status).toBe(429);
  expect((await h.login('sub-budget-editor')).status).toBe(200);
  expect((await h.login('sub-budget-admin')).status).toBe(200);
});

test('only admins receive the budget status with their session', async () => {
  const h = setup();
  await h.vote();
  const admin = await (await h.request('/api/session', { as: 'budget-admin' })).json() as { writeBudget?: Record<string, unknown> };
  expect(admin.writeBudget).toEqual({ day: writeBudgetDay(Date.now()), used: h.used(), limit: DAILY_SHARED_WRITE_LIMIT,
    exhaustedAt: null, resetsAt: expect.any(Number) });
  for (const as of ['budget-editor', 'budget-member', undefined]) {
    expect(await (await h.request('/api/session', { as })).json()).not.toHaveProperty('writeBudget');
  }
  h.spend();
  const spent = await (await h.request('/api/session', { as: 'budget-admin' })).json() as { writeBudget: { exhaustedAt: number } };
  expect(spent.writeBudget.exhaustedAt).toBe(1);
});
