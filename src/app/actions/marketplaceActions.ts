"use server";

import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole, MarketplaceType, ActorType, Prisma, InventoryBalance, ProductCondition } from "@prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Saves/updates configuration parameters for a given marketplace integration.
 */
export async function saveMarketplaceConfigAction(
  type: MarketplaceType,
  mode: "REAL" | "DEMO",
  credentials: Record<string, string>
) {
  const user = await checkRole([UserRole.ADMIN]);

  try {
    const credString = JSON.stringify(credentials);

    await prisma.marketplace.upsert({
      where: { id: type },
      create: {
        id: type,
        name: type.toLowerCase(),
        status: "CONNECTED",
        mode,
        credentialsJson: credString,
        supportsOrders: type !== MarketplaceType.CATAWIKI,
        supportsInventorySync: type !== MarketplaceType.CATAWIKI,
        supportsPriceFeed: true,
        supportsAuctions: type === MarketplaceType.CATAWIKI,
        supportsWebhooks: type === MarketplaceType.SHOPIFY,
      },
      update: {
        status: "CONNECTED",
        mode,
        credentialsJson: credString,
      },
    });

    // Write administrative AuditLog
    await prisma.auditLog.create({
      data: {
        actorType: ActorType.USER,
        actorId: user.id,
        actorName: user.name,
        action: "CONNECT_MARKETPLACE",
        details: `Successfully connected ${type} in ${mode} mode.`,
      },
    });

    revalidatePath("/marketplaces");
    return { success: true as const };
  } catch (err) {
    console.error("Save marketplace config failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Disconnects and resets a marketplace configuration back to default DEMO mode.
 */
export async function disconnectMarketplaceAction(type: MarketplaceType) {
  const user = await checkRole([UserRole.ADMIN]);

  try {
    await prisma.marketplace.update({
      where: { id: type },
      data: {
        status: "DISCONNECTED",
        mode: "DEMO",
        credentialsJson: null,
      },
    });

    // Write administrative AuditLog
    await prisma.auditLog.create({
      data: {
        actorType: ActorType.USER,
        actorId: user.id,
        actorName: user.name,
        action: "DISCONNECT_MARKETPLACE",
        details: `Successfully disconnected ${type} marketplace.`,
      },
    });

    revalidatePath("/marketplaces");
    return { success: true as const };
  } catch (err) {
    console.error("Disconnect marketplace failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Commits the Shopify initial onboarding product and inventory import.
 */
export async function commitShopifyImportAction(params: {
  inventoryAccountId: string;
  items: {
    sku: string;
    setNumber: string;
    title: string;
    price: number;
    quantity: number;
    condition: string;
  }[];
}) {
  const user = await checkRole([UserRole.ADMIN]);

  try {
    const result = await prisma.$transaction(async (tx) => {
      let createdProducts = 0;
      let createdVariants = 0;
      let stockImported = 0;

      for (const item of params.items) {
        // 1. Resolve product
        let product = await tx.product.findUnique({
          where: { setNumber: item.setNumber },
        });

        if (!product) {
          product = await tx.product.create({
            data: {
              setNumber: item.setNumber,
              name: item.title,
              theme: "Shopify Onboarding",
              status: "ACTIVE",
            },
          });
          createdProducts++;
        }

        // 2. Resolve variant
        let variant = await tx.productVariant.findUnique({
          where: { sku: item.sku },
        });

        if (!variant) {
          variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: item.sku,
              condition: item.condition as ProductCondition,
              status: "ACTIVE",
            },
          });
          createdVariants++;
        }

        // 3. Import quantity to the target account (Vervliet Enterprises/Company)
        // Concurrency lock FOR UPDATE
        const balances = await tx.$queryRaw<InventoryBalance[]>`
          SELECT * FROM "InventoryBalance"
          WHERE "productVariantId" = ${variant.id}
            AND "inventoryAccountId" = ${params.inventoryAccountId}
          LIMIT 1 FOR UPDATE
        `;

        const existing = balances[0];
        if (existing) {
          const oldQty = existing.quantity;
          const oldAvgCost = Number(existing.averageCost);
          const newQty = oldQty + item.quantity;
          // Assuming 40% margin as default acquisition cost on Shopify import if cost is unavailable
          const unitCost = item.price * 0.6;
          const newAvgCost = (oldQty * oldAvgCost + item.quantity * unitCost) / newQty;

          await tx.inventoryBalance.update({
            where: { id: existing.id },
            data: {
              quantity: newQty,
              averageCost: new Prisma.Decimal(newAvgCost),
              lastUpdated: new Date(),
            },
          });
        } else {
          const unitCost = item.price * 0.6;
          await tx.inventoryBalance.create({
            data: {
              productVariantId: variant.id,
              inventoryAccountId: params.inventoryAccountId,
              quantity: item.quantity,
              averageCost: new Prisma.Decimal(unitCost),
            },
          });
        }

        // 4. Write ledger IMPORT transaction
        await tx.inventoryTransaction.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: params.inventoryAccountId,
            type: "IMPORT",
            quantity: item.quantity,
            unitCost: new Prisma.Decimal(item.price * 0.6),
            actorType: "USER",
            actorId: user.id,
            actorName: user.name,
            notes: `Initial Shopify onboarding import`,
          },
        });

        stockImported += item.quantity;
      }

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          actorType: "USER",
          actorId: user.id,
          actorName: user.name,
          action: "SHOPIFY_IMPORT",
          details: `Imported ${params.items.length} listings from Shopify. Created ${createdProducts} products, ${createdVariants} variants, and loaded ${stockImported} units of stock.`,
        },
      });

      return {
        createdProducts,
        createdVariants,
        stockImported,
      };
    });

    revalidatePath("/inventory");
    revalidatePath("/");
    return { success: true as const, data: result };
  } catch (err) {
    console.error("Shopify import commit failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}
