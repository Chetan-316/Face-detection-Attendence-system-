-- Read-only preflight for 20261001120000. Informational: no rows block this migration.
-- ADD COLUMN IF NOT EXISTS adds a nullable TEXT column with no default, so existing rows are unchanged.
SELECT COUNT(*) AS residents_rows FROM "residents";
