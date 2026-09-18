-- AlterEnum
ALTER TYPE "ObservationProvenance" ADD VALUE IF NOT EXISTS 'LIVE_SEARCH';

-- AlterTable Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productType" TEXT NOT NULL DEFAULT 'LEGO_SET';

-- AlterTable LegoResearchHistory
ALTER TABLE "LegoResearchHistory" ADD COLUMN IF NOT EXISTS "identifierType" TEXT DEFAULT 'LEGO_SET';
ALTER TABLE "LegoResearchHistory" ADD COLUMN IF NOT EXISTS "resolvedMetadataJson" TEXT;
