-- CreateEnum
CREATE TYPE "ObservationProvenance" AS ENUM ('LIVE_API', 'LIVE_SCRAPE', 'MANUAL', 'IMPORTED', 'SIMULATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'RECONCILIATION_DISCREPANCY';
ALTER TYPE "AlertType" ADD VALUE 'EXTERNAL_AUTH_FAILURE';
ALTER TYPE "AlertType" ADD VALUE 'INSUFFICIENT_MARKET_EVIDENCE';

-- AlterTable
ALTER TABLE "InventoryBalance" ADD COLUMN     "knownCostQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "knownCostTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "MarketPriceSnapshot" ADD COLUMN     "provenance" "ObservationProvenance" NOT NULL DEFAULT 'IMPORTED',
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "rawMetadataJson" TEXT;

-- AlterTable
ALTER TABLE "SyncJob" ADD COLUMN     "resultSummary" TEXT;

-- CreateIndex
CREATE INDEX "MarketPriceSnapshot_productId_capturedAt_idx" ON "MarketPriceSnapshot"("productId", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketPriceSnapshot_provenance_idx" ON "MarketPriceSnapshot"("provenance");

-- Backfill existing inventory balances with known cost basis
UPDATE "InventoryBalance"
SET "knownCostQuantity" = "quantity",
    "knownCostTotal" = ROUND("quantity" * "averageCost", 2)
WHERE "averageCost" IS NOT NULL AND "averageCost" > 0 AND "quantity" > 0;

