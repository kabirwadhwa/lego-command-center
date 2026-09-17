import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  UserRole,
  InventoryAccountType,
  MarketplaceType,
  ListingStatus,
  ProductCondition,
  VariantStatus,
  PurchaseStatus
} from "@prisma/client";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (token !== "7919a1be-8967-4e2d-a3a6-1b11cf106a64") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    console.log("Seeding production database with complete inventory...");

    // 1. Seed Users
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

    // 2. Seed Accounts
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

    // 3. Seed Marketplaces
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

    // 4. Load inventory seed file
    const jsonPath = path.join(process.cwd(), "prisma/inventory-seed.json");
    let rawData: SeedItem[] = [];
    if (fs.existsSync(jsonPath)) {
      rawData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    }

    if (rawData.length > 0) {
      const setMap = new Map<string, {
        setNumber: string;
        setName: string;
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
            companyQty: 0,
            companyTotalCost: 0,
            personalQty: 0,
            personalTotalCost: 0
          });
        }

        const setObj = setMap.get(item.setNumber)!;
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

      // Upsert products and balances
      for (const setInfo of Array.from(setMap.values())) {
        const sku = `LGO-${setInfo.setNumber}-NEW_SEALED`;

        const product = await prisma.product.upsert({
          where: { setNumber: setInfo.setNumber },
          update: { name: setInfo.setName },
          create: {
            setNumber: setInfo.setNumber,
            name: setInfo.setName,
            theme: "Icons",
            status: "ACTIVE"
          }
        });

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

        const companyAvgCost = setInfo.companyQty > 0
          ? setInfo.companyTotalCost / setInfo.companyQty
          : 0;
        const personalAvgCost = setInfo.personalQty > 0
          ? setInfo.personalTotalCost / setInfo.personalQty
          : 0;

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
      }
    }

    // 5. Run initial pricing sweep
    const { PriceEngineService } = await import("@/services/pricing/priceEngineService");
    await PriceEngineService.runFullPricingSweep(20);

    console.log("Full database seeding completed successfully.");
    return NextResponse.json({ success: true, count: rawData.length });
  } catch (error: any) {
    console.error("Test Seed API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal Error" }, { status: 500 });
  }
}
