import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env';
import { createDatabase } from './data/database';
import {
  currentScorepadCatalogVersion,
  listScorepadGameChangesSince,
  lookupScorepadGamesByBgg,
  type ScorepadGame,
  type ScorepadGameChanges,
} from './data/scorepadCatalog';
import {
  getScorepadGameRules,
  getScorepadRuleSummaryByBgg,
  type ScorepadGameRules,
  type ScorepadRuleSummary,
} from './data/scorepadRules';
import { getScorepadCatalog, type ScorepadCatalog } from './data/scorepadSnapshot';

/**
 * Internal RPC for the score pad Worker (service "board-game-helper",
 * entrypoint "ScorepadApi"). RPC methods are not reachable through fetch, so
 * this has no public URL, no CORS and no session. Every method is read-only,
 * except that getScorepadCatalog builds its stored entries once if no schedule has yet.
 */
export class ScorepadApi extends WorkerEntrypoint<Env> {
  lookupGamesByBgg(bggIds: string[]): Promise<ScorepadGame[]> {
    return lookupScorepadGamesByBgg(createDatabase(this.env), bggIds);
  }

  currentGameCatalogVersion(): Promise<number> {
    return currentScorepadCatalogVersion(createDatabase(this.env));
  }

  listGameChangesSince(afterVersion: number, limit: number): Promise<ScorepadGameChanges> {
    return listScorepadGameChangesSince(createDatabase(this.env), afterVersion, limit);
  }

  /** The whole catalog of games with a BGG id, or `unchanged` when knownVersion is current. */
  getScorepadCatalog(knownVersion?: string): Promise<ScorepadCatalog> {
    return getScorepadCatalog(createDatabase(this.env), knownVersion);
  }

  getRuleSummaryByBgg(bggId: string): Promise<ScorepadRuleSummary | null> {
    return getScorepadRuleSummaryByBgg(createDatabase(this.env), bggId);
  }

  getGameRules(gameId: string): Promise<ScorepadGameRules | null> {
    return getScorepadGameRules(createDatabase(this.env), gameId);
  }
}
