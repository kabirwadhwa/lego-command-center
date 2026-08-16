import { prisma } from "@/lib/prisma";
import {
  InventoryTransactionType,
  ActorType,
  MarketplaceType,
  Prisma,
  InventoryBalance,
} from "@prisma/client";

// Custom typed domain errors
export class DomainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export interface PurchaseItemInput {
  productVariantId: string;
  inventoryAccountId: string;
  quantity: number;
  unitCost: number;
}

export interface SaleItemInput {
  productVariantId: string;
  inventoryAccountId: string;
  quantity: number;
  unitSalePrice: number;
}

/**
 * Service governing all inventory ledger mutations and accounting constraints.
 */
export class InventoryService {
  /**
   * Processes a commercial purchase intake.
   * Atomically logs purchase records, updates average costs, and increments stock.
   */
  static async recordPurchase(params: {
    actorId: string;
    actorName: string;
    supplier: string;
    purchaseDate: Date;
    items: PurchaseItemInput[];
    notes?: string;
  }) {
    const { actorId, actorName, supplier, purchaseDate, items, notes } = params;

    if (items.length === 0) {
      throw new DomainError("VALIDATION_ERROR", "Purchase must contain at least one item.");
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Create the commercial Purchase record
      const totalCost = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      const purchase = await tx.purchase.create({
        data: {
          supplier,
          purchaseDate,
          status: "RECEIVED",
          totalCost: new Prisma.Decimal(totalCost),
          notes,
        },
      });

      // 2. Loop through and intake each item
      for (const item of items) {
        if (item.quantity <= 0) {
          throw new DomainError("VALIDATION_ERROR", "Intake quantity must be greater than zero.");
        }

        // Write the commercial PurchaseItem record
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productVariantId: item.productVariantId,
            inventoryAccountId: item.inventoryAccountId,
            quantity: item.quantity,
            unitCost: new Prisma.Decimal(item.unitCost),
          },
        });

        // Concurrency Lock: Select row FOR UPDATE
        const balances = await tx.$queryRaw<InventoryBalance[]>`
          SELECT * FROM "InventoryBalance"
          WHERE "productVariantId" = ${item.productVariantId}
            AND "inventoryAccountId" = ${item.inventoryAccountId}
          LIMIT 1 FOR UPDATE
        `;

        const existingBalance = balances[0];
        let newQty = item.quantity;
        let newAvgCost = item.unitCost;

        if (existingBalance) {
          const oldQty = existingBalance.quantity;
          const oldAvgCost = Number(existingBalance.averageCost);
          newQty = oldQty + item.quantity;
          // Weighted moving average cost formula:
          newAvgCost = (oldQty * oldAvgCost + item.quantity * item.unitCost) / newQty;

          await tx.inventoryBalance.update({
            where: { id: existingBalance.id },
            data: {
              quantity: newQty,
              averageCost: new Prisma.Decimal(newAvgCost),
              lastUpdated: new Date(),
            },
          });
        } else {
          // If no balance exists, insert it
          await tx.inventoryBalance.create({
            data: {
              productVariantId: item.productVariantId,
              inventoryAccountId: item.inventoryAccountId,
              quantity: item.quantity,
              averageCost: new Prisma.Decimal(item.unitCost),
            },
          });
        }

        // Add entry to the immutable ledger
        await tx.inventoryTransaction.create({
          data: {
            productVariantId: item.productVariantId,
            inventoryAccountId: item.inventoryAccountId,
            type: InventoryTransactionType.PURCHASE,
            quantity: item.quantity,
            unitCost: new Prisma.Decimal(item.unitCost),
            actorType: ActorType.USER,
            actorId,
            actorName,
            notes: notes || `Purchase intake from supplier: ${supplier}`,
          },
        });
      }

      // 3. Write System Audit Log entry
      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId,
          actorName,
          action: "RECORD_PURCHASE",
          details: `Logged purchase intake from ${supplier} containing ${items.length} items. Total: ${fmt(totalCost)}`,
        },
      });

      return purchase;
    });
  }

  /**
   * Processes a commercial sale transaction.
   * Atomically validates stock availability, deducts stock, and records commercial revenue.
   */
  static async recordSale(params: {
    actorType: ActorType;
    actorId: string;
    actorName: string;
    marketplaceId?: MarketplaceType;
    externalOrderId?: string;
    saleDate: Date;
    items: SaleItemInput[];
    notes?: string;
    grossRevenue: number;
    marketplaceFees?: number;
    shippingRevenue?: number;
    shippingCost?: number;
    discount?: number;
  }) {
    const {
      actorType,
      actorId,
      actorName,
      marketplaceId,
      externalOrderId,
      saleDate,
      items,
      notes,
      grossRevenue,
      marketplaceFees = 0,
      shippingRevenue = 0,
      shippingCost = 0,
      discount = 0,
    } = params;

    if (items.length === 0) {
      throw new DomainError("VALIDATION_ERROR", "Sale must contain at least one item.");
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Order-level Idempotency Check
      if (marketplaceId && externalOrderId) {
        const existingSale = await tx.sale.findUnique({
          where: {
            marketplaceId_externalOrderId: {
              marketplaceId,
              externalOrderId,
            },
          },
        });
        if (existingSale) {
          throw new DomainError(
            "DUPLICATE_EXTERNAL_ORDER",
            `Order reference '${externalOrderId}' has already been processed for marketplace '${marketplaceId}'.`
          );
        }
      }

      // 2. Resolve items, checking stock availability with row-level locks
      const processedSaleItems = [];
      for (const item of items) {
        if (item.quantity <= 0) {
          throw new DomainError("VALIDATION_ERROR", "Sale quantity must be greater than zero.");
        }

        // Concurrency Lock: Select row FOR UPDATE
        const balances = await tx.$queryRaw<InventoryBalance[]>`
          SELECT * FROM "InventoryBalance"
          WHERE "productVariantId" = ${item.productVariantId}
            AND "inventoryAccountId" = ${item.inventoryAccountId}
          LIMIT 1 FOR UPDATE
        `;

        const existingBalance = balances[0];
        if (!existingBalance || existingBalance.quantity < item.quantity) {
          throw new DomainError(
            "INSUFFICIENT_STOCK",
            `Insufficient stock for variant ID '${item.productVariantId}' on target inventory account.`
          );
        }

        const costAtSale = Number(existingBalance.averageCost);
        const lineRevenue = item.quantity * item.unitSalePrice;

        // Decrement balance
        await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            quantity: existingBalance.quantity - item.quantity,
            lastUpdated: new Date(),
          },
        });

        // Write the immutable ledger transaction
        await tx.inventoryTransaction.create({
          data: {
            productVariantId: item.productVariantId,
            inventoryAccountId: item.inventoryAccountId,
            type: InventoryTransactionType.SALE,
            quantity: -item.quantity,
            unitCost: new Prisma.Decimal(costAtSale),
            channel: marketplaceId,
            externalOrderId,
            actorType,
            actorId,
            actorName,
            notes: notes || `Sale transaction processed via channel: ${marketplaceId || "OFFLINE"}`,
          },
        });

        processedSaleItems.push({
          productVariantId: item.productVariantId,
          inventoryAccountId: item.inventoryAccountId,
          quantity: item.quantity,
          unitSalePrice: new Prisma.Decimal(item.unitSalePrice),
          unitCostAtSale: new Prisma.Decimal(costAtSale),
          lineRevenue: new Prisma.Decimal(lineRevenue),
        });
      }

      // 3. Create the commercial Sale and SaleItem records
      const netRevenue = grossRevenue - marketplaceFees - shippingCost - discount;
      const sale = await tx.sale.create({
        data: {
          marketplaceId,
          externalOrderId,
          saleDate,
          status: "COMPLETED",
          grossRevenue: new Prisma.Decimal(grossRevenue),
          marketplaceFees: new Prisma.Decimal(marketplaceFees),
          shippingRevenue: new Prisma.Decimal(shippingRevenue),
          shippingCost: new Prisma.Decimal(shippingCost),
          discount: new Prisma.Decimal(discount),
          netRevenue: new Prisma.Decimal(netRevenue),
          notes,
          items: {
            create: processedSaleItems,
          },
        },
      });

      // 4. Create Audit Log entry
      await tx.auditLog.create({
        data: {
          actorType,
          actorId,
          actorName,
          action: "RECORD_SALE",
          details: `Processed sale order #${externalOrderId || sale.id.substring(0, 8)} (${marketplaceId || "OFFLINE"}). Gross: ${fmt(grossRevenue)}`,
        },
      });

      return sale;
    });
  }

  /**
   * Transfers stock between two inventory accounts.
   * Atomically decrements the source and increments the destination inside a row-locked transaction.
   */
  static async transferStock(params: {
    actorId: string;
    actorName: string;
    productVariantId: string;
    sourceAccountId: string;
    destinationAccountId: string;
    quantity: number;
    notes?: string;
  }) {
    const {
      actorId,
      actorName,
      productVariantId,
      sourceAccountId,
      destinationAccountId,
      quantity,
      notes,
    } = params;

    if (quantity <= 0) {
      throw new DomainError("VALIDATION_ERROR", "Transfer quantity must be greater than zero.");
    }
    if (sourceAccountId === destinationAccountId) {
      throw new DomainError("VALIDATION_ERROR", "Source and destination accounts must be distinct.");
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Lock the source balance row FOR UPDATE
      const sourceBalances = await tx.$queryRaw<InventoryBalance[]>`
        SELECT * FROM "InventoryBalance"
        WHERE "productVariantId" = ${productVariantId}
          AND "inventoryAccountId" = ${sourceAccountId}
        LIMIT 1 FOR UPDATE
      `;

      const sourceBalance = sourceBalances[0];
      if (!sourceBalance || sourceBalance.quantity < quantity) {
        throw new DomainError(
          "INSUFFICIENT_STOCK",
          "Transfer failed: Source account does not possess sufficient stock."
        );
      }

      const costBasis = Number(sourceBalance.averageCost);

      // Lock destination balance row FOR UPDATE (if exists)
      const destBalances = await tx.$queryRaw<InventoryBalance[]>`
        SELECT * FROM "InventoryBalance"
        WHERE "productVariantId" = ${productVariantId}
          AND "inventoryAccountId" = ${destinationAccountId}
        LIMIT 1 FOR UPDATE
      `;
      const destBalance = destBalances[0];

      // 2. Perform balance mutations
      await tx.inventoryBalance.update({
        where: { id: sourceBalance.id },
        data: {
          quantity: sourceBalance.quantity - quantity,
          lastUpdated: new Date(),
        },
      });

      if (destBalance) {
        const destOldQty = destBalance.quantity;
        const destOldAvgCost = Number(destBalance.averageCost);
        const destNewQty = destOldQty + quantity;
        // Calculate new weighted cost basis on target account:
        const destNewAvgCost = (destOldQty * destOldAvgCost + quantity * costBasis) / destNewQty;

        await tx.inventoryBalance.update({
          where: { id: destBalance.id },
          data: {
            quantity: destNewQty,
            averageCost: new Prisma.Decimal(destNewAvgCost),
            lastUpdated: new Date(),
          },
        });
      } else {
        await tx.inventoryBalance.create({
          data: {
            productVariantId,
            inventoryAccountId: destinationAccountId,
            quantity,
            averageCost: new Prisma.Decimal(costBasis),
          },
        });
      }

      // 3. Create linked double-entry transactions
      const tx1 = await tx.inventoryTransaction.create({
        data: {
          productVariantId,
          inventoryAccountId: sourceAccountId,
          type: InventoryTransactionType.TRANSFER,
          quantity: -quantity,
          unitCost: new Prisma.Decimal(costBasis),
          actorType: ActorType.USER,
          actorId,
          actorName,
          notes: notes || "Double-entry transfer (debit)",
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          productVariantId,
          inventoryAccountId: destinationAccountId,
          type: InventoryTransactionType.TRANSFER,
          quantity,
          unitCost: new Prisma.Decimal(costBasis),
          linkedTransactionId: tx1.id,
          actorType: ActorType.USER,
          actorId,
          actorName,
          notes: notes || "Double-entry transfer (credit)",
        },
      });

      // 4. Create Audit Log entry
      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId,
          actorName,
          action: "TRANSFER_STOCK",
          details: `Transferred ${quantity} units of variant '${productVariantId}' from account '${sourceAccountId}' to '${destinationAccountId}'.`,
        },
      });

      return { success: true };
    });
  }

  /**
   * Processes manual stock adjustments (shrinkage, count corrections, write-offs).
   */
  static async adjustStock(params: {
    actorId: string;
    actorName: string;
    productVariantId: string;
    inventoryAccountId: string;
    type: InventoryTransactionType;
    quantityChange: number;
    unitCost?: number;
    notes?: string;
  }) {
    const {
      actorId,
      actorName,
      productVariantId,
      inventoryAccountId,
      type,
      quantityChange,
      unitCost,
      notes,
    } = params;

    if (quantityChange === 0) {
      throw new DomainError("VALIDATION_ERROR", "Adjustment quantity change cannot be zero.");
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Lock the balance row FOR UPDATE
      const balances = await tx.$queryRaw<InventoryBalance[]>`
        SELECT * FROM "InventoryBalance"
        WHERE "productVariantId" = ${productVariantId}
          AND "inventoryAccountId" = ${inventoryAccountId}
        LIMIT 1 FOR UPDATE
      `;

      const existingBalance = balances[0];
      const costBasis = unitCost ?? (existingBalance ? Number(existingBalance.averageCost) : 0);

      if (existingBalance) {
        const newQty = existingBalance.quantity + quantityChange;
        if (newQty < 0) {
          throw new DomainError("INSUFFICIENT_STOCK", "Adjustment would result in negative stock balance.");
        }

        // Recalculate average cost only if we are adding stock
        let newAvgCost = Number(existingBalance.averageCost);
        if (quantityChange > 0) {
          newAvgCost = (existingBalance.quantity * newAvgCost + quantityChange * costBasis) / newQty;
        }

        await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            quantity: newQty,
            averageCost: new Prisma.Decimal(newAvgCost),
            lastUpdated: new Date(),
          },
        });
      } else {
        if (quantityChange < 0) {
          throw new DomainError("INSUFFICIENT_STOCK", "Adjustment would result in negative stock balance.");
        }
        await tx.inventoryBalance.create({
          data: {
            productVariantId,
            inventoryAccountId,
            quantity: quantityChange,
            averageCost: new Prisma.Decimal(costBasis),
          },
        });
      }

      // 2. Log transaction ledger entry
      await tx.inventoryTransaction.create({
        data: {
          productVariantId,
          inventoryAccountId,
          type,
          quantity: quantityChange,
          unitCost: new Prisma.Decimal(costBasis),
          actorType: ActorType.USER,
          actorId,
          actorName,
          notes: notes || `Manual stock adjustment: ${type}`,
        },
      });

      // 3. Create Audit Log entry
      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId,
          actorName,
          action: "ADJUST_STOCK",
          details: `Adjusted stock of variant '${productVariantId}' on account '${inventoryAccountId}' by ${quantityChange > 0 ? `+${quantityChange}` : quantityChange} units (Reason: ${type}).`,
        },
      });

      return { success: true };
    });
  }
}

// Simple internal formatter helper
const fmt = (val: number) => {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(val);
};
