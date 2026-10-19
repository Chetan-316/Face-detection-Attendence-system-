-- AlterTable
ALTER TABLE "hostels" ADD COLUMN IF NOT EXISTS "returnDeadlineMinutes" INTEGER NOT NULL DEFAULT 1260;

-- Minutes from local midnight; values outside the day are invalid
ALTER TABLE "hostels" ADD CONSTRAINT "hostels_returnDeadlineMinutes_range_check" CHECK ("returnDeadlineMinutes" BETWEEN 0 AND 1439);
