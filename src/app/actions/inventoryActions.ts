"use server";

import { revalidatePath } from "next/cache";
import { checkRole } from "@/lib/auth";
import { InventoryService, PurchaseItemInput, SaleItemInput } from "@/services/inventoryService";
import { UserRole, InventoryTransactionType, ActorType, ProductCondition, InventoryBalance, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Server action to record a new purchase intake.
 */
export async function createPurchaseAction(params: {
  supplier: string;
  purchaseDate: Date;
  items: PurchaseItemInput[];
  notes?: string;
}) {
  const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);
  
  try {
    const purchase = await InventoryService.recordPurchase({
      actorId: user.id,
      actorName: user.name,
      supplier: params.supplier,
      purchaseDate: params.purchaseDate,
      items: params.items,
      notes: params.notes,
    });
    
    revalidatePath("/purchases");
    revalidatePath("/inventory");
    revalidatePath("/");
    
    return { success: true as const, data: purchase };
  } catch (err) {
    console.error("Purchase intake action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Server action to record a manual offline sale.
 */
export async function createManualSaleAction(params: {
  productVariantId: string;
  inventoryAccountId: string;
  quantity: number;
  unitSalePrice: number;
  notes?: string;
}) {
  const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  const items: SaleItemInput[] = [
    {
      productVariantId: params.productVariantId,
      inventoryAccountId: params.inventoryAccountId,
      quantity: params.quantity,
      unitSalePrice: params.unitSalePrice,
    },
  ];

  try {
    const grossRevenue = params.quantity * params.unitSalePrice;
    
    const sale = await InventoryService.recordSale({
      actorType: ActorType.USER,
      actorId: user.id,
      actorName: user.name,
      saleDate: new Date(),
      items,
      grossRevenue,
      notes: params.notes,
    });

    revalidatePath("/sales");
    revalidatePath("/inventory");
    revalidatePath("/");

    return { success: true as const, data: sale };
  } catch (err) {
    console.error("Manual sale action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Server action to transfer stock between accounts.
 */
export async function transferStockAction(params: {
  productVariantId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  quantity: number;
  notes?: string;
}) {
  const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    await InventoryService.transferStock({
      actorId: user.id,
      actorName: user.name,
      productVariantId: params.productVariantId,
      sourceAccountId: params.sourceAccountId,
      destinationAccountId: params.destinationAccountId,
      quantity: params.quantity,
      notes: params.notes,
    });

    revalidatePath("/inventory");
    revalidatePath("/");

    return { success: true as const };
  } catch (err) {
    console.error("Stock transfer action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Server action to adjust stock levels (Admin/Seller adjustments).
 */
export async function adjustStockAction(params: {
  productVariantId: string;
  inventoryAccountId: string;
  type: InventoryTransactionType;
  quantityChange: number;
  unitCost?: number;
  notes?: string;
}) {
  const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    await InventoryService.adjustStock({
      actorId: user.id,
      actorName: user.name,
      productVariantId: params.productVariantId,
      inventoryAccountId: params.inventoryAccountId,
      type: params.type,
      quantityChange: params.quantityChange,
      unitCost: params.unitCost,
      notes: params.notes,
    });

    revalidatePath("/inventory");
    revalidatePath("/");

    return { success: true as const };
  } catch (err) {
    console.error("Stock adjustment action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Server action to create a completely new Product and Variant.
 */
export async function createNewProductAction(params: {
  setNumber: string;
  name: string;
  theme: string;
  ean?: string;
  sku: string;
  condition: string;
  storageLocation?: string;
  notes?: string;
}) {
  await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    const variant = await prisma.$transaction(async (tx) => {
      // Check if product exists, if not create it
      let product = await tx.product.findUnique({
        where: { setNumber: params.setNumber }
      });

      if (!product) {
        product = await tx.product.create({
          data: {
            setNumber: params.setNumber,
            name: params.name,
            theme: params.theme,
            ean: params.ean,
            status: "ACTIVE",
          }
        });
      }

      // Check if variant exists
      const existingVariant = await tx.productVariant.findUnique({
        where: { sku: params.sku }
      });

      if (existingVariant) {
        throw new Error(`Variant SKU '${params.sku}' already exists.`);
      }

      // Create new variant
      const newVar = await tx.productVariant.create({
        data: {
          productId: product.id,
          sku: params.sku,
          condition: params.condition as ProductCondition,
          storageLocation: params.storageLocation,
          notes: params.notes,
          status: "ACTIVE"
        }
      });

      return newVar;
    });

    revalidatePath("/inventory");
    return { success: true as const, data: variant };
  } catch (err) {
    console.error("Create product variant action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Server action to bulk import inventory from parsed sheet rows.
 */
export async function bulkImportAction(params: {
  inventoryAccountId: string;
  rows: {
    setNumber: string;
    name?: string;
    theme?: string;
    sku?: string;
    ean?: string;
    condition: string;
    quantity: number;
    unitCost: number;
    storageLocation?: string;
  }[];
}) {
  const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    const result = await prisma.$transaction(async (tx) => {
      let createdProductsCount = 0;
      let createdVariantsCount = 0;
      let transactionCount = 0;

      for (const row of params.rows) {
        // 1. Resolve product
        let product = await tx.product.findUnique({
          where: { setNumber: row.setNumber }
        });

        if (!product) {
          product = await tx.product.create({
            data: {
              setNumber: row.setNumber,
              name: row.name || `LEGO ${row.setNumber}`,
              theme: row.theme || "Imported Theme",
              ean: row.ean,
              status: "ACTIVE",
            }
          });
          createdProductsCount++;
        }

        // 2. Resolve variant SKU
        const cond = row.condition as ProductCondition;
        const generatedSku = row.sku || `LGO-${row.setNumber}-${cond}`;
        
        let variant = await tx.productVariant.findUnique({
          where: { sku: generatedSku }
        });

        if (!variant) {
          variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: generatedSku,
              condition: cond,
              storageLocation: row.storageLocation,
              status: "ACTIVE"
            }
          });
          createdVariantsCount++;
        }

        // 3. Concurrency Lock: Select row FOR UPDATE
        const balances = await tx.$queryRaw<InventoryBalance[]>`
          SELECT * FROM "InventoryBalance"
          WHERE "productVariantId" = ${variant.id}
            AND "inventoryAccountId" = ${params.inventoryAccountId}
          LIMIT 1 FOR UPDATE
        `;

        const existingBalance = balances[0];
        if (existingBalance) {
          const oldQty = existingBalance.quantity;
          const oldAvgCost = Number(existingBalance.averageCost);
          const newQty = oldQty + row.quantity;
          const newAvgCost = (oldQty * oldAvgCost + row.quantity * row.unitCost) / newQty;

          await tx.inventoryBalance.update({
            where: { id: existingBalance.id },
            data: {
              quantity: newQty,
              averageCost: new Prisma.Decimal(newAvgCost),
              lastUpdated: new Date()
            }
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              productVariantId: variant.id,
              inventoryAccountId: params.inventoryAccountId,
              quantity: row.quantity,
              averageCost: new Prisma.Decimal(row.unitCost)
            }
          });
        }

        // 4. Create immutable ledger movement (IMPORT)
        await tx.inventoryTransaction.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: params.inventoryAccountId,
            type: InventoryTransactionType.IMPORT,
            quantity: row.quantity,
            unitCost: new Prisma.Decimal(row.unitCost),
            actorType: ActorType.USER,
            actorId: user.id,
            actorName: user.name,
            notes: `Bulk imported inventory data`
          }
        });

        transactionCount++;
      }

      // 5. Log administrative AuditLog
      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId: user.id,
          actorName: user.name,
          action: "BULK_IMPORT",
          details: `Successfully bulk imported ${transactionCount} inventory items. Created ${createdProductsCount} products and ${createdVariantsCount} variants.`
        }
      });

      return {
        processedCount: transactionCount,
        createdProductsCount,
        createdVariantsCount,
      };
    });

    revalidatePath("/inventory");
    revalidatePath("/");
    return { success: true as const, data: result };
  } catch (err) {
    console.error("Bulk import failed:", err);
    const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { success: false as const, error: errorMsg };
  }
}
