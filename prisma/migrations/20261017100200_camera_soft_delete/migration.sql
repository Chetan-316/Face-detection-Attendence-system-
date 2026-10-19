-- AlterTable
ALTER TABLE "cameras" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Keep movement history: a camera referenced by a movement event cannot be hard-deleted
ALTER TABLE "movement_events" DROP CONSTRAINT "movement_events_cameraId_fkey";

-- AddForeignKey
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "cameras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
