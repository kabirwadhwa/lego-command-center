-- AlterTable
ALTER TABLE "InventoryBalance" ALTER COLUMN "averageCost" DROP NOT NULL,
ALTER COLUMN "averageCost" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "marketplaceFees" DROP NOT NULL,
ALTER COLUMN "marketplaceFees" DROP DEFAULT,
ALTER COLUMN "netRevenue" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "unitCostAtSale" DROP NOT NULL;
