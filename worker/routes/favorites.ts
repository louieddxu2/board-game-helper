import { Hono } from 'hono';
import { requireUser, type AppVariables } from '../auth';
import { getDatabase } from '../data/database';
import {
  addFavorite,
  clearFavorites,
  FavoriteLimitError,
  markFavoriteSeen,
  queryFavoriteStatus,
  queryPersonalHome,
  removeFavorite,
} from '../data/favorites';
import type { RouteEnv } from '../env';
import { now } from '../utils';

const favoriteRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

favoriteRoutes.get('/api/account/home', requireUser, async (c) =>
  c.json(await queryPersonalHome(getDatabase(c), c.get('user')!.id)));

favoriteRoutes.get('/api/account/favorites/:gameId', requireUser, async (c) =>
  c.json(await queryFavoriteStatus(getDatabase(c), c.get('user')!.id, c.req.param('gameId'))));

favoriteRoutes.post('/api/account/favorites/:gameId', requireUser, async (c) => {
  try {
    return c.json(await addFavorite(getDatabase(c), c.get('user')!.id, c.req.param('gameId'), now()));
  } catch (error) {
    if (error instanceof FavoriteLimitError) return c.json({ error: error.message }, 409);
    if (error instanceof Error && error.message === 'game_not_found') return c.json({ error: error.message }, 404);
    throw error;
  }
});

favoriteRoutes.delete('/api/account/favorites/:gameId', requireUser, async (c) =>
  c.json(await removeFavorite(getDatabase(c), c.get('user')!.id, c.req.param('gameId'))));

favoriteRoutes.delete('/api/account/favorites', requireUser, async (c) =>
  c.json(await clearFavorites(getDatabase(c), c.get('user')!.id)));

favoriteRoutes.post('/api/account/favorites/:gameId/seen', requireUser, async (c) =>
  c.json(await markFavoriteSeen(getDatabase(c), c.get('user')!.id, c.req.param('gameId'))));

export { favoriteRoutes };
