-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'FAMILY_SELLER', 'VIEWER');

-- CreateEnum
CREATE TYPE "InventoryAccountType" AS ENUM ('COMPANY', 'PERSONAL');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('PURCHASE', 'SALE', 'TRANSFER', 'MANUAL_ADJUSTMENT', 'RETURN', 'DAMAGED', 'STOCK_COUNT_CORRECTION', 'IMPORT');

-- CreateEnum
CREATE TYPE "MarketplaceType" AS ENUM ('SHOPIFY', 'BOL', 'CATAWIKI', 'BRICKLINK', 'EBAY');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('ASKING_PRICE', 'BUY_NOW', 'CURRENT_BID', 'SOLD_PRICE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('RECEIVED', 'PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('LOW_STOCK', 'OUT_OF_STOCK', 'SYNC_ERROR', 'UNMATCHED_ORDER', 'PRICE_OPPORTUNITY', 'UNPROFITABLE_PRICE', 'STALE_DATA', 'MISSING_SKU');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductCondition" AS ENUM ('NEW_SEALED', 'USED_COMPLETE', 'DAMAGED_BOX');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'MARKETPLACE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "setNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ean" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "condition" "ProductCondition" NOT NULL DEFAULT 'NEW_SEALED',
    "storageLocation" TEXT,
    "notes" TEXT,
    "status" "VariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InventoryAccountType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "inventoryAccountId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "averageCost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "inventoryAccountId" TEXT NOT NULL,
    "type" "InventoryTransactionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2),
    "channel" "MarketplaceType",
    "externalOrderId" TEXT,
    "linkedTransactionId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "marketplaceId" "MarketplaceType",
    "externalOrderId" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "grossRevenue" DECIMAL(12,2) NOT NULL,
    "marketplaceFees" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "shippingRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "netRevenue" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "inventoryAccountId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitSalePrice" DECIMAL(12,2) NOT NULL,
    "unitCostAtSale" DECIMAL(12,2) NOT NULL,
    "lineRevenue" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'RECEIVED',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "totalCost" DECIMAL(12,2) NOT NULL,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "importFees" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "inventoryAccountId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceEvent" (
    "id" TEXT NOT NULL,
    "marketplaceId" "MarketplaceType" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingStatus" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "payload" TEXT,

    CONSTRAINT "MarketplaceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marketplace" (
    "id" "MarketplaceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "credentialsJson" TEXT,
    "supportsOrders" BOOLEAN NOT NULL DEFAULT true,
    "supportsInventorySync" BOOLEAN NOT NULL DEFAULT true,
    "supportsPriceFeed" BOOLEAN NOT NULL DEFAULT false,
    "supportsAuctions" BOOLEAN NOT NULL DEFAULT false,
    "supportsWebhooks" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Marketplace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "marketplace" "MarketplaceType" NOT NULL,
    "externalListingId" TEXT NOT NULL,
    "listingUrl" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "catawikiCurrentBid" DECIMAL(12,2),
    "catawikiReserve" DECIMAL(12,2),
    "catawikiBuyNow" DECIMAL(12,2),
    "catawikiAuctionEnd" TIMESTAMP(3),

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPriceSnapshot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "priceType" "PriceType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "shipping" DECIMAL(12,2),
    "condition" TEXT,
    "seller" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalListingId" TEXT,
    "externalUrl" TEXT,
    "auctionEndAt" TIMESTAMP(3),
    "availability" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MarketPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRecommendation" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "recommendedPrice" DECIMAL(12,2) NOT NULL,
    "reasoning" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "marketplace" "MarketplaceType" NOT NULL,
    "operation" TEXT NOT NULL,
    "productVariantId" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorDetails" TEXT,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_setNumber_key" ON "Product"("setNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAccount_name_key" ON "InventoryAccount"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_productVariantId_inventoryAccountId_key" ON "InventoryBalance"("productVariantId", "inventoryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_marketplaceId_externalOrderId_key" ON "Sale"("marketplaceId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceEvent_marketplaceId_externalEventId_key" ON "MarketplaceEvent"("marketplaceId", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_marketplace_externalListingId_key" ON "MarketplaceListing"("marketplace", "externalListingId");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPriceSnapshot" ADD CONSTRAINT "MarketPriceSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRecommendation" ADD CONSTRAINT "PriceRecommendation_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
