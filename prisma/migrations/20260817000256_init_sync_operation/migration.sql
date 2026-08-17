/*
  Warnings:

  - Changed the type of `operation` on the `SyncJob` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('SYNC_INVENTORY', 'SYNC_PRICE', 'REFRESH_PRICE_OBSERVATIONS', 'RECONCILE');

-- AlterTable
ALTER TABLE "SyncJob" DROP COLUMN "operation",
ADD COLUMN     "operation" "SyncOperation" NOT NULL;
