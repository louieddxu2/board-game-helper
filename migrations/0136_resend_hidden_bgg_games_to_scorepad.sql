-- The score pad's game catalog now lists hidden expansions that carry a BGG id
-- (the site hides them while their names await review). Its incremental sync
-- already passed these games as deleted, so queue each once more for a new
-- catalog version. The ids are the ten such games in production when this was
-- written; the primary-key lookups keep the cost fixed.
INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
SELECT 'game', g.id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games g
WHERE g.id IN (
  'game-variant-9ed2c54c8df0def67ce27e8ce22b48b4',
  'game-variant-f015cfa1284bbda7d9ddb2a6873a3592',
  'game-variant-4530be3ae7625f2efcccc85c0f4ab7c3',
  'game-variant-6dd1ace633ea4515c39a48d7352d8414',
  'game-variant-d401b14cd9f0c1f8572d9038a86c3191',
  'game-variant-9f1da5f3a9355899c4d5ebb50e5134ff',
  'game-variant-fe717910d995640905efb4a2f3f80202',
  'game-variant-614654ecc6231f6dee07fe1dd83bb837',
  'game-variant-de17050f85120803ed2b53c2746e154f',
  'game-variant-59893fe783051d33e2e2ae05f45ad1da'
)
ON CONFLICT(catalog, entity_key) DO UPDATE SET
  change_kind = excluded.change_kind, updated_at = excluded.updated_at,
  revision = catalog_change_outbox.revision + 1;
