import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { UserRole, InventoryAccountType, MarketplaceType, ListingStatus, ProductCondition, VariantStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (token !== "7919a1be-8967-4e2d-a3a6-1b11cf106a64") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    console.log("Seeding database via API...");

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
    for (const mType of [MarketplaceType.SHOPIFY, MarketplaceType.BOL, MarketplaceType.CATAWIKI]) {
      await prisma.marketplace.upsert({
        where: { id: mType },
        update: {},
        create: {
          id: mType,
          name: mType.charAt(0) + mType.slice(1).toLowerCase() + " Store",
          status: "CONNECTED",
          mode: "DEMO"
        }
      });
    }

    // 4. Seed Products & Variants
    // Set 10330 (Concorde)
    const product10330 = await prisma.product.upsert({
      where: { setNumber: "10330" },
      update: {},
      create: {
        setNumber: "10330",
        name: "LEGO Icons Concorde",
        theme: "Icons",
        pieceCount: 2083,
        retailPrice: 199.99,
        status: "ACTIVE"
      }
    });

    const variant10330 = await prisma.productVariant.upsert({
      where: { sku: "LGO-10330-NEW_SEALED" },
      update: {},
      create: {
        productId: product10330.id,
        sku: "LGO-10330-NEW_SEALED",
        condition: ProductCondition.NEW_SEALED,
        status: VariantStatus.ACTIVE
      }
    });

    // Seed empty balance records if not present
    await prisma.inventoryBalance.upsert({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: variant10330.id,
          inventoryAccountId: companyAcc.id
        }
      },
      update: {},
      create: {
        productVariantId: variant10330.id,
        inventoryAccountId: companyAcc.id,
        quantity: 0
      }
    });

    await prisma.inventoryBalance.upsert({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: variant10330.id,
          inventoryAccountId: personalAcc.id
        }
      },
      update: {},
      create: {
        productVariantId: variant10330.id,
        inventoryAccountId: personalAcc.id,
        quantity: 0
      }
    });

    // Set 10316 (Rivendell)
    const product10316 = await prisma.product.upsert({
      where: { setNumber: "10316" },
      update: {},
      create: {
        setNumber: "10316",
        name: "LEGO Icons Lord of the Rings: Rivendell",
        theme: "Icons",
        pieceCount: 6167,
        retailPrice: 499.99,
        status: "ACTIVE"
      }
    });

    const variant10316 = await prisma.productVariant.upsert({
      where: { sku: "LGO-10316-NEW_SEALED" },
      update: {},
      create: {
        productId: product10316.id,
        sku: "LGO-10316-NEW_SEALED",
        condition: ProductCondition.NEW_SEALED,
        status: VariantStatus.ACTIVE
      }
    });

    await prisma.inventoryBalance.upsert({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: variant10316.id,
          inventoryAccountId: companyAcc.id
        }
      },
      update: {},
      create: {
        productVariantId: variant10316.id,
        inventoryAccountId: companyAcc.id,
        quantity: 0
      }
    });

    // Seed marketplace listing records to test syncs
    await prisma.marketplaceListing.upsert({
      where: {
        marketplace_externalListingId: {
          marketplace: MarketplaceType.SHOPIFY,
          externalListingId: "gid://shopify/ProductVariant/smoke-test-10330"
        }
      },
      update: {},
      create: {
        productVariantId: variant10330.id,
        marketplace: MarketplaceType.SHOPIFY,
        externalListingId: "gid://shopify/ProductVariant/smoke-test-10330",
        shopifyInventoryItemId: "gid://shopify/InventoryItem/smoke-test-item-10330",
        shopifyLocationId: "gid://shopify/Location/smoke-test-loc-10330",
        price: 199.99,
        quantity: 0,
        status: ListingStatus.ACTIVE
      }
    });

    console.log("Seeding database via API successful.");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Test Seed API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal Error" }, { status: 500 });
  }
}
