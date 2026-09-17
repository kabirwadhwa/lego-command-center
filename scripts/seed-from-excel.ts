import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  PrismaClient,
  UserRole,
  InventoryAccountType,
  MarketplaceType,
  ListingStatus,
  ProductCondition,
  VariantStatus,
  PurchaseStatus
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface SeedItem {
  lotId: string;
  setNumber: string;
  setName: string;
  quantity: number;
  purchaseDate: string;
  supplier: string;
  unitCost: number;
  vatRegime: "INVOICE" | "MARGIN";
  ownership: "COMPANY" | "PRIVATE";
  status: string;
}

export async function runExcelSeed() {
  console.log("🚀 Starting database seeding from Excel inventory dataset...");

  const jsonPath = path.join(process.cwd(), "prisma/inventory-seed.json");
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Seed JSON file not found at ${jsonPath}. Run scripts/convert-excel-to-json.py first.`);
  }

  const rawData: SeedItem[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`Loaded ${rawData.length} lines from seed JSON.`);

  // 1. Core Users
  console.log("Seeding core users...");
  const kristof = await prisma.user.upsert({
    where: { id: "44444444-4444-4444-4444-444444444444" },
    update: {},
    create: {
      id: "44444444-4444-4444-4444-444444444444",
      email: "kristof@vervliet.be",
      name: "Kristof Vervliet",
      role: UserRole.ADMIN,
      status: "ACTIVE"
    }
  });

  const sabine = await prisma.user.upsert({
    where: { id: "55555555-5555-5555-5555-555555555555" },
    update: {},
    create: {
      id: "55555555-5555-5555-5555-555555555555",
      email: "sabine@vervliet.be",
      name: "Sabine Vervliet",
      role: UserRole.FAMILY_SELLER,
      status: "ACTIVE"
    }
  });

  // 2. Inventory Accounts
  console.log("Seeding inventory accounts...");
  const companyAcc = await prisma.inventoryAccount.upsert({
    where: { id: "89379ebf-1b89-41d8-814c-b71f8003c12c" },
    update: {},
    create: {
      id: "89379ebf-1b89-41d8-814c-b71f8003c12c",
      name: "Vervliet Enterprises Company Stock",
      type: InventoryAccountType.COMPANY,
      status: "ACTIVE"
    }
  });

  const personalAcc = await prisma.inventoryAccount.upsert({
    where: { id: "c1a3b5b6-7c9d-4e2f-8a1b-3c4d5e6f7a8b" },
    update: {},
    create: {
      id: "c1a3b5b6-7c9d-4e2f-8a1b-3c4d5e6f7a8b",
      name: "Kristof Private Portfolio",
      type: InventoryAccountType.PERSONAL,
      status: "ACTIVE"
    }
  });

  // 3. Marketplaces
  console.log("Seeding marketplaces...");
  for (const mType of [
    MarketplaceType.SHOPIFY,
    MarketplaceType.BOL,
    MarketplaceType.CATAWIKI,
    MarketplaceType.BRICKLINK,
    MarketplaceType.EBAY
  ]) {
    await prisma.marketplace.upsert({
      where: { id: mType },
      update: {},
      create: {
        id: mType,
        name: mType.charAt(0) + mType.slice(1).toLowerCase() + " Marketplace",
        status: "CONNECTED",
        mode: "DEMO",
        supportsOrders: mType !== MarketplaceType.CATAWIKI,
        supportsInventorySync: mType === MarketplaceType.SHOPIFY || mType === MarketplaceType.BOL,
        supportsPriceFeed: true,
        supportsAuctions: mType === MarketplaceType.CATAWIKI
      }
    });
  }

  // 4. Group data by Product Set Number
  console.log("Aggregating sets and inventory lines...");
  const setMap = new Map<string, {
    setNumber: string;
    setName: string;
    lines: SeedItem[];
    companyQty: number;
    companyTotalCost: number;
    personalQty: number;
    personalTotalCost: number;
  }>();

  for (const item of rawData) {
    if (!setMap.has(item.setNumber)) {
      setMap.set(item.setNumber, {
        setNumber: item.setNumber,
        setName: item.setName,
        lines: [],
        companyQty: 0,
        companyTotalCost: 0,
        personalQty: 0,
        personalTotalCost: 0
      });
    }

    const setObj = setMap.get(item.setNumber)!;
    setObj.lines.push(item);

    const isPersonal = item.ownership === "PRIVATE";
    const lineCost = item.unitCost * item.quantity;

    if (isPersonal) {
      setObj.personalQty += item.quantity;
      setObj.personalTotalCost += lineCost;
    } else {
      setObj.companyQty += item.quantity;
      setObj.companyTotalCost += lineCost;
    }
  }

  console.log(`Processing ${setMap.size} unique LEGO sets in batches...`);

  // 5. Batch insert products and variants
  const sets = Array.from(setMap.values());
  let processedCount = 0;

  for (const setInfo of sets) {
    const sku = `LGO-${setInfo.setNumber}-NEW_SEALED`;

    // Upsert product
    const product = await prisma.product.upsert({
      where: { setNumber: setInfo.setNumber },
      update: { name: setInfo.setName },
      create: {
        setNumber: setInfo.setNumber,
        name: setInfo.setName,
        theme: "Icons", // Default theme
        status: "ACTIVE"
      }
    });

    // Upsert variant
    const variant = await prisma.productVariant.upsert({
      where: { sku },
      update: {},
      create: {
        productId: product.id,
        sku,
        condition: ProductCondition.NEW_SEALED,
        status: VariantStatus.ACTIVE
      }
    });

    // Calculate weighted average costs
    const companyAvgCost = setInfo.companyQty > 0
      ? setInfo.companyTotalCost / setInfo.companyQty
      : 0;
    const personalAvgCost = setInfo.personalQty > 0
      ? setInfo.personalTotalCost / setInfo.personalQty
      : 0;

    // Upsert Company Balance
    await prisma.inventoryBalance.upsert({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: variant.id,
          inventoryAccountId: companyAcc.id
        }
      },
      update: {
        quantity: setInfo.companyQty,
        averageCost: companyAvgCost > 0 ? companyAvgCost : null,
        lastUpdated: new Date()
      },
      create: {
        productVariantId: variant.id,
        inventoryAccountId: companyAcc.id,
        quantity: setInfo.companyQty,
        averageCost: companyAvgCost > 0 ? companyAvgCost : null
      }
    });

    // Upsert Personal Balance
    await prisma.inventoryBalance.upsert({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: variant.id,
          inventoryAccountId: personalAcc.id
        }
      },
      update: {
        quantity: setInfo.personalQty,
        averageCost: personalAvgCost > 0 ? personalAvgCost : null,
        lastUpdated: new Date()
      },
      create: {
        productVariantId: variant.id,
        inventoryAccountId: personalAcc.id,
        quantity: setInfo.personalQty,
        averageCost: personalAvgCost > 0 ? personalAvgCost : null
      }
    });

    // Seed active listings for sets with Company stock > 0
    if (setInfo.companyQty > 0) {
      const suggestedPrice = Math.round((companyAvgCost > 0 ? companyAvgCost * 1.35 : 49.99) * 100) / 100;
      await prisma.marketplaceListing.upsert({
        where: {
          marketplace_externalListingId: {
            marketplace: MarketplaceType.SHOPIFY,
            externalListingId: `shopify-${setInfo.setNumber}`
          }
        },
        update: {
          quantity: setInfo.companyQty,
          price: suggestedPrice
        },
        create: {
          productVariantId: variant.id,
          marketplace: MarketplaceType.SHOPIFY,
          externalListingId: `shopify-${setInfo.setNumber}`,
          quantity: setInfo.companyQty,
          price: suggestedPrice,
          status: ListingStatus.ACTIVE
        }
      });
    }

    processedCount++;
    if (processedCount % 200 === 0 || processedCount === sets.length) {
      console.log(`Ingested ${processedCount} / ${sets.length} sets...`);
    }
  }

  // 6. Record sample purchase batches from lots
  console.log("Recording purchase lots...");
  const lotMap = new Map<string, SeedItem[]>();
  for (const item of rawData.slice(0, 300)) { // Record first 300 lot lines as Purchases
    if (!lotMap.has(item.lotId)) lotMap.set(item.lotId, []);
    lotMap.get(item.lotId)!.push(item);
  }

  for (const [lotId, lotItems] of lotMap.entries()) {
    const supplier = lotItems[0].supplier;
    const purchaseDate = new Date(lotItems[0].purchaseDate);
    const totalCost = lotItems.reduce((sum, i) => sum + i.unitCost * i.quantity, 0);

    const purchase = await prisma.purchase.create({
      data: {
        supplier,
        purchaseDate,
        status: PurchaseStatus.RECEIVED,
        totalCost,
        notes: `Intake Lot: ${lotId}`
      }
    });

    for (const line of lotItems) {
      const variant = await prisma.productVariant.findUnique({
        where: { sku: `LGO-${line.setNumber}-NEW_SEALED` }
      });
      if (variant) {
        const targetAccId = line.ownership === "PRIVATE" ? personalAcc.id : companyAcc.id;
        await prisma.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productVariantId: variant.id,
            inventoryAccountId: targetAccId,
            quantity: line.quantity,
            unitCost: line.unitCost
          }
        });
      }
    }
  }

  console.log("✅ Successfully seeded database with real inventory dataset!");
}

runExcelSeed()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

