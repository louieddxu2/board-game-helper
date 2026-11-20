-- catalog_version is already UNIQUE. Its automatic index serves both delta
-- pagination and bounded retention, including their version ordering.
DROP INDEX IF EXISTS idx_attribute_catalog_entries_version;
