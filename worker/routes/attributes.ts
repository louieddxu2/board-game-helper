import { Hono } from 'hono';
import { getDatabase } from '../data/database';
import { queryAttributesPayload } from '../data/attributes';
import type { RouteEnv } from '../env';
import type { AppVariables } from '../auth';

const attributesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

attributesRoutes.get('/api/attributes', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await queryAttributesPayload(getDatabase(c)));
});

export { attributesRoutes };
