-- Step 07.1: Add UNIQUE constraint on movement_events.recognitionReference
-- Purpose: Provides database-level idempotency guarantee for face-recognition-generated
--          movement events.  PostgreSQL treats each NULL value as distinct for standard
--          UNIQUE indexes, so rows with recognitionReference = NULL are allowed to coexist.
--          Only non-null recognition observation IDs are effectively unique-constrained.

-- Standard Prisma-compatible unique constraint (matches @unique in schema.prisma)
CREATE UNIQUE INDEX IF NOT EXISTS "movement_events_recognitionReference_key"
ON "movement_events" ("recognitionReference");