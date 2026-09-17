-- AlterTable PriceRecommendation
ALTER TABLE "PriceRecommendation" ADD COLUMN "confidenceScore" INTEGER,
ADD COLUMN "confidenceTier" TEXT,
ADD COLUMN "observationCount" INTEGER DEFAULT 0,
ADD COLUMN "marketMedian" DECIMAL(12,2),
ADD COLUMN "marketMin" DECIMAL(12,2),
ADD COLUMN "marketMax" DECIMAL(12,2),
ADD COLUMN "evidenceUpdatedAt" TIMESTAMP(3);

-- CreateTable LegoResearchHistory
CREATE TABLE "LegoResearchHistory" (
    "id" TEXT NOT NULL,
    "setNumber" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "theme" TEXT,
    "imageUrl" TEXT,
    "recommendedPrice" DECIMAL(12,2),
    "marketMedian" DECIMAL(12,2),
    "marketMin" DECIMAL(12,2),
    "marketMax" DECIMAL(12,2),
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "confidenceScore" INTEGER,
    "confidenceTier" TEXT,
    "targetChannel" TEXT,
    "hypotheticalCost" DECIMAL(12,2),
    "potentialMargin" DECIMAL(12,2),
    "potentialProfit" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegoResearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegoResearchHistory_setNumber_idx" ON "LegoResearchHistory"("setNumber");
CREATE INDEX "LegoResearchHistory_researchedAt_idx" ON "LegoResearchHistory"("researchedAt");

-- Backfill existing recommendations with conservative structured defaults
UPDATE "PriceRecommendation"
SET "confidenceScore" = NULL,
    "confidenceTier" = 'LOW',
    "observationCount" = 2,
    "marketMedian" = "recommendedPrice",
    "marketMin" = "recommendedPrice",
    "marketMax" = "recommendedPrice",
    "evidenceUpdatedAt" = "updatedAt"
WHERE "confidenceScore" IS NULL;
