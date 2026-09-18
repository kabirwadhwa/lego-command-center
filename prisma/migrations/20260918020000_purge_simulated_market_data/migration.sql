-- Migration: purge_simulated_market_data
-- Completely removes simulated/synthetic market price snapshots, contaminated research history,
-- and contaminated price recommendations from the database.

-- 1. Purge all simulated or synthetic market price snapshots
DELETE FROM "MarketPriceSnapshot" 
WHERE "provenance" = 'SIMULATED' 
   OR "provider" = 'simulator/demo'
   OR "seller" ILIKE '%simulated%'
   OR "externalUrl" ILIKE '%simulated%';

-- 2. Purge contaminated research history records (including set 35106 test run)
DELETE FROM "LegoResearchHistory" 
WHERE "setNumber" = '35106'
   OR "recommendedPrice" = 138.47;

-- 3. Delete any price recommendations where no genuine snapshots exist for the product
DELETE FROM "PriceRecommendation"
WHERE "productVariantId" IN (
  SELECT pv."id"
  FROM "ProductVariant" pv
  JOIN "Product" p ON pv."productId" = p."id"
  WHERE NOT EXISTS (
    SELECT 1 FROM "MarketPriceSnapshot" mps 
    WHERE mps."productId" = p."id" 
      AND mps."provenance" IN ('LIVE_API', 'LIVE_SCRAPE', 'MANUAL', 'IMPORTED')
  )
);
