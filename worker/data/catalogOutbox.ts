import type { AttributeDefinition, AttributeImportCandidate, AttributeMatrixValue, AttributeSubject, GameSummary, TagSummary } from '../../src/shared/types';
import type { Database } from './database';
import {
  queryAttributeCandidatesById,
  queryAttributeDefinitionsById,
  queryAttributeSubjectBundles,
} from './attributes';
import { queryTargetedGameCatalogEntries } from './gameCatalog';
import { queryTargetedPublicTagCatalogEntries } from './tagCatalog';

export const CATALOG_OUTBOX_PAGE_SIZE = 100;

export type CatalogOutboxKind =
  | 'game'
  | 'attribute-subject'
  | 'attribute-definition'
  | 'attribute-candidate'
  | 'tag';

interface CatalogOutboxRow {
  catalog: CatalogOutboxKind;
  entity_key: string;
  revision: number;
}

interface VersionedEntry {
  entryKey: string;
  entryJson: string | null;
  deleted: boolean;
  updatedAt: number;
}

interface CatalogStore {
  reserve: (db: Database, count: number) => Promise<number>;
  write: (db: Database, entries: Array<VersionedEntry & { catalogVersion: number }>) => Promise<void>;
}

export interface CatalogOutboxFlushResult {
  mode: 'legacy' | 'outbox';
  processed: Partial<Record<CatalogOutboxKind, number>>;
}

const now = () => Date.now();

const unique = (ids: string[]) => [...new Set(ids)].sort();

const attributeCatalogStore: CatalogStore = {
  reserve: async (db, count) => {
    const row = await db.statement(`
      UPDATE attribute_catalog_clock
      SET current_version = current_version + ?
      WHERE id = 1
      RETURNING current_version
    `).bind(count).first<{ current_version: number }>();
    if (!row) throw new Error('attribute_catalog_clock_unavailable');
    return Number(row.current_version);
  },
  write: async (db, entries) => {
    await db.batch(entries.map((entry) => db.statement(`
      INSERT INTO attribute_catalog_entries
        (entry_key, catalog_version, entry_json, deleted, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entry_key) DO UPDATE SET
        catalog_version = excluded.catalog_version,
        entry_json = excluded.entry_json,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at
    `).bind(entry.entryKey, entry.catalogVersion, entry.entryJson, entry.deleted ? 1 : 0, entry.updatedAt)));
  },
};

const gameCatalogStore: CatalogStore = {
  reserve: async (db, count) => {
    const row = await db.statement(`
      UPDATE game_catalog_clock
      SET current_version = current_version + ?
      WHERE id = 1
      RETURNING current_version
    `).bind(count).first<{ current_version: number }>();
    if (!row) throw new Error('game_catalog_clock_unavailable');
    return Number(row.current_version);
  },
  write: async (db, entries) => {
    await db.batch(entries.map((entry) => db.statement(`
      INSERT INTO game_catalog_entries
        (game_id, catalog_version, entry_json, deleted, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET
        catalog_version = excluded.catalog_version,
        entry_json = excluded.entry_json,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at
    `).bind(entry.entryKey, entry.catalogVersion, entry.entryJson, entry.deleted ? 1 : 0, entry.updatedAt)));
  },
};

const tagCatalogStore: CatalogStore = {
  reserve: async (db, count) => {
    const row = await db.statement(`
      UPDATE public_tag_catalog_clock
      SET current_version = current_version + ?
      WHERE id = 1
      RETURNING current_version
    `).bind(count).first<{ current_version: number }>();
    if (!row) throw new Error('public_tag_catalog_clock_unavailable');
    return Number(row.current_version);
  },
  write: async (db, entries) => {
    await db.batch(entries.map((entry) => db.statement(`
      INSERT INTO public_tag_catalog_entries
        (tag_id, catalog_version, entry_json, deleted, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tag_id) DO UPDATE SET
        catalog_version = excluded.catalog_version,
        entry_json = excluded.entry_json,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at
    `).bind(entry.entryKey, entry.catalogVersion, entry.entryJson, entry.deleted ? 1 : 0, entry.updatedAt)));
  },
};

const publishEntries = async (db: Database, store: CatalogStore, entries: VersionedEntry[]): Promise<void> => {
  if (!entries.length) return;
  const endVersion = await store.reserve(db, entries.length);
  const startVersion = endVersion - entries.length + 1;
  await store.write(db, entries.map((entry, index) => ({
    ...entry,
    catalogVersion: startVersion + index,
  })));
};

const deletedEntry = (entryKey: string, timestamp: number): VersionedEntry => ({
  entryKey,
  entryJson: null,
  deleted: true,
  updatedAt: timestamp,
});

const publishGameEntries = async (db: Database, gameIds: string[], timestamp: number): Promise<void> => {
  const records = await queryTargetedGameCatalogEntries(db, gameIds);
  const byId = new Map(records.map((record) => [record.gameId, record]));
  const entries = gameIds.map((gameId) => {
    const record = byId.get(gameId);
    if (!record || record.deleted || !record.game) return deletedEntry(gameId, record?.updatedAt ?? timestamp);
    return {
      entryKey: gameId,
      entryJson: JSON.stringify(record.game satisfies GameSummary),
      deleted: false,
      updatedAt: record.updatedAt,
    };
  });
  await publishEntries(db, gameCatalogStore, entries);
};

const publishAttributeSubjectEntries = async (db: Database, subjectIds: string[], timestamp: number): Promise<void> => {
  const bundles = await queryAttributeSubjectBundles(db, subjectIds);
  const byId = new Map(bundles.map((bundle) => [bundle.subject.id, bundle]));
  const entries = subjectIds.map((subjectId) => {
    const bundle = byId.get(subjectId);
    if (!bundle) return deletedEntry(`subject:${subjectId}`, timestamp);
    return {
      entryKey: `subject:${subjectId}`,
      entryJson: JSON.stringify({
        kind: 'subjectBundle',
        subject: bundle.subject satisfies AttributeSubject,
        values: bundle.values satisfies AttributeMatrixValue[],
      }),
      deleted: false,
      updatedAt: timestamp,
    };
  });
  await publishEntries(db, attributeCatalogStore, entries);
};

const publishAttributeDefinitionEntries = async (db: Database, attributeIds: string[], timestamp: number): Promise<void> => {
  const definitions = await queryAttributeDefinitionsById(db, attributeIds);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const entries = attributeIds.map((attributeId) => {
    const attribute = byId.get(attributeId);
    if (!attribute) return deletedEntry(`attribute:${attributeId}`, timestamp);
    return {
      entryKey: `attribute:${attributeId}`,
      entryJson: JSON.stringify({ kind: 'attribute', attribute: attribute satisfies AttributeDefinition }),
      deleted: false,
      updatedAt: timestamp,
    };
  });
  await publishEntries(db, attributeCatalogStore, entries);
};

const publishAttributeCandidateEntries = async (db: Database, candidateIds: string[], timestamp: number): Promise<void> => {
  const candidates = await queryAttributeCandidatesById(db, candidateIds);
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const entries = candidateIds.map((candidateId) => {
    const candidate = byId.get(candidateId);
    if (!candidate) return deletedEntry(`candidate:${candidateId}`, timestamp);
    return {
      entryKey: `candidate:${candidateId}`,
      entryJson: JSON.stringify({ kind: 'candidate', ...(candidate satisfies AttributeImportCandidate) }),
      deleted: false,
      updatedAt: timestamp,
    };
  });
  await publishEntries(db, attributeCatalogStore, entries);
};

const publishTagEntries = async (db: Database, tagIds: string[], timestamp: number): Promise<void> => {
  const records = await queryTargetedPublicTagCatalogEntries(db, tagIds);
  const byId = new Map(records.map((record) => [record.tagId, record]));
  const entries = tagIds.map((tagId) => {
    const record = byId.get(tagId);
    if (!record || record.deleted || !record.tag) return deletedEntry(tagId, record?.updatedAt ?? timestamp);
    return {
      entryKey: tagId,
      entryJson: JSON.stringify(record.tag satisfies TagSummary),
      deleted: false,
      updatedAt: record.updatedAt,
    };
  });
  await publishEntries(db, tagCatalogStore, entries);
};

const deletePublishedRows = async (db: Database, catalog: CatalogOutboxKind, rows: CatalogOutboxRow[]): Promise<void> => {
  if (!rows.length) return;
  await db.statement(`
    DELETE FROM catalog_change_outbox
    WHERE catalog = ?
      AND (entity_key, revision) IN (${rows.map(() => '(?, ?)').join(', ')})
  `).bind(catalog, ...rows.flatMap((row) => [row.entity_key, row.revision])).run();
};

const outboxMode = async (db: Database): Promise<'legacy' | 'outbox'> => {
  try {
    const row = await db.statement(`
      SELECT mode
      FROM catalog_outbox_settings
      WHERE id = 1
    `).first<{ mode: string }>();
    return row?.mode === 'outbox' ? 'outbox' : 'legacy';
  } catch (error) {
    // The foundation migration is deliberately compatible with the old
    // Worker. If an operator deploys code before that migration, leave the
    // existing trigger path alone instead of turning a successful mutation
    // into a cache-publishing failure.
    if (error instanceof Error && /no such table:\s*catalog_outbox_settings/i.test(error.message)) return 'legacy';
    throw error;
  }
};

/**
 * Publish the IDs collected by SQLite triggers.  Triggers perform no view
 * expansion or JSON work; this function owns those explicit, targeted reads.
 */
export const flushCatalogOutbox = async (
  db: Database,
  timestamp = now(),
  limit = CATALOG_OUTBOX_PAGE_SIZE,
): Promise<CatalogOutboxFlushResult> => {
  const mode = await outboxMode(db);
  if (mode !== 'outbox') return { mode, processed: {} };
  const result = await db.statement(`
    SELECT catalog, entity_key, revision
    FROM catalog_change_outbox
    ORDER BY updated_at, catalog, entity_key
    LIMIT ?
  `).bind(limit).all<CatalogOutboxRow>();
  const rows = result.results ?? [];
  const byCatalog = new Map<CatalogOutboxKind, CatalogOutboxRow[]>();
  rows.forEach((row) => {
    const entries = byCatalog.get(row.catalog) ?? [];
    entries.push(row);
    byCatalog.set(row.catalog, entries);
  });
  const processed: Partial<Record<CatalogOutboxKind, number>> = {};
  for (const catalog of ['game', 'attribute-subject', 'attribute-definition', 'attribute-candidate', 'tag'] as const) {
    const catalogRows = byCatalog.get(catalog) ?? [];
    if (!catalogRows.length) continue;
    const entityKeys = unique(catalogRows.map((row) => row.entity_key));
    if (catalog === 'game') await publishGameEntries(db, entityKeys, timestamp);
    if (catalog === 'attribute-subject') await publishAttributeSubjectEntries(db, entityKeys, timestamp);
    if (catalog === 'attribute-definition') await publishAttributeDefinitionEntries(db, entityKeys, timestamp);
    if (catalog === 'attribute-candidate') await publishAttributeCandidateEntries(db, entityKeys, timestamp);
    if (catalog === 'tag') await publishTagEntries(db, entityKeys, timestamp);
    await deletePublishedRows(db, catalog, catalogRows);
    processed[catalog] = catalogRows.length;
  }
  return { mode, processed };
};
