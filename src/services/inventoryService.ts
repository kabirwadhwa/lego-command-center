import { prisma } from "@/lib/prisma";
import {
  InventoryTransactionType,
  ActorType,
  MarketplaceType,
  Prisma,
  InventoryBalance,
  ProductCondition,
  ProductVariant,
  InventoryTransaction,
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

        if (existingBalance) {
          const oldQty = existingBalance.quantity;
          const oldKnownQty = existingBalance.knownCostQuantity ?? 0;
          const oldKnownTotal = existingBalance.knownCostTotal !== null ? Number(existingBalance.knownCostTotal) : 0;

          const newQty = oldQty + item.quantity;
          const newKnownQty = oldKnownQty + item.quantity;
          const newKnownTotal = oldKnownTotal + (item.quantity * item.unitCost);
          const newAvgCost = newKnownTotal / newKnownQty;

          await tx.inventoryBalance.update({
            where: { id: existingBalance.id },
            data: {
              quantity: newQty,
              knownCostQuantity: newKnownQty,
              knownCostTotal: new Prisma.Decimal(newKnownTotal),
              averageCost: new Prisma.Decimal(newAvgCost),
              lastUpdated: new Date(),
            },
          });
        } else {
          const totalKnown = item.quantity * item.unitCost;
          await tx.inventoryBalance.create({
            data: {
              productVariantId: item.productVariantId,
              inventoryAccountId: item.inventoryAccountId,
              quantity: item.quantity,
              knownCostQuantity: item.quantity,
              knownCostTotal: new Prisma.Decimal(totalKnown),
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
    marketplaceFees?: number | null;
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
      marketplaceFees = null,
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

        const totalQty = existingBalance.quantity;
        const knownQty = existingBalance.knownCostQuantity ?? 0;
        const knownTotal = existingBalance.knownCostTotal !== null ? Number(existingBalance.knownCostTotal) : 0;
        const avgCost = existingBalance.averageCost !== null ? Number(existingBalance.averageCost) : null;

        // Proportional depletion of known cost units
        let soldKnownQty = 0;
        if (knownQty === totalQty) {
          soldKnownQty = item.quantity;
        } else if (knownQty === 0) {
          soldKnownQty = 0;
        } else {
          soldKnownQty = Math.min(knownQty, Math.round(item.quantity * (knownQty / totalQty)));
        }

        const remainingKnownQty = Math.max(0, knownQty - soldKnownQty);
        let remainingKnownTotal = 0;
        let costAtSale: number | null = null;

        if (soldKnownQty > 0 && avgCost !== null) {
          costAtSale = avgCost;
          remainingKnownTotal = Math.max(0, knownTotal - (soldKnownQty * avgCost));
        } else if (knownQty > 0 && avgCost !== null) {
          remainingKnownTotal = knownTotal;
        }

        const newAvgCost = remainingKnownQty > 0 ? remainingKnownTotal / remainingKnownQty : null;
        const lineRevenue = item.quantity * item.unitSalePrice;

        // Decrement balance
        await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            quantity: totalQty - item.quantity,
            knownCostQuantity: remainingKnownQty,
            knownCostTotal: new Prisma.Decimal(remainingKnownTotal),
            averageCost: newAvgCost !== null ? new Prisma.Decimal(newAvgCost) : null,
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
            unitCost: costAtSale !== null ? new Prisma.Decimal(costAtSale) : null,
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
          unitCostAtSale: costAtSale !== null ? new Prisma.Decimal(costAtSale) : null,
          lineRevenue: new Prisma.Decimal(lineRevenue),
        });
      }

      // 3. Create the commercial Sale and SaleItem records
      const netRevenue = marketplaceFees !== null 
        ? grossRevenue - marketplaceFees - shippingCost - discount 
        : null;
      const sale = await tx.sale.create({
        data: {
          marketplaceId,
          externalOrderId,
          saleDate,
          status: "COMPLETED",
          grossRevenue: new Prisma.Decimal(grossRevenue),
          marketplaceFees: marketplaceFees !== null ? new Prisma.Decimal(marketplaceFees) : null,
          shippingRevenue: new Prisma.Decimal(shippingRevenue),
          shippingCost: new Prisma.Decimal(shippingCost),
          discount: new Prisma.Decimal(discount),
          netRevenue: netRevenue !== null ? new Prisma.Decimal(netRevenue) : null,
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

      const srcTotalQty = sourceBalance.quantity;
      const srcKnownQty = sourceBalance.knownCostQuantity ?? 0;
      const srcKnownTotal = sourceBalance.knownCostTotal !== null ? Number(sourceBalance.knownCostTotal) : 0;
      const srcAvgCost = sourceBalance.averageCost !== null ? Number(sourceBalance.averageCost) : null;

      // Determine proportional units of known cost transferred
      let transKnownQty = 0;
      if (srcKnownQty === srcTotalQty) {
        transKnownQty = quantity;
      } else if (srcKnownQty === 0) {
        transKnownQty = 0;
      } else {
        transKnownQty = Math.min(srcKnownQty, Math.round(quantity * (srcKnownQty / srcTotalQty)));
      }

      const transKnownValue = (transKnownQty > 0 && srcAvgCost !== null) ? transKnownQty * srcAvgCost : 0;
      const newSrcKnownQty = Math.max(0, srcKnownQty - transKnownQty);
      const newSrcKnownTotal = Math.max(0, srcKnownTotal - transKnownValue);
      const newSrcAvgCost = newSrcKnownQty > 0 ? newSrcKnownTotal / newSrcKnownQty : null;

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
          quantity: srcTotalQty - quantity,
          knownCostQuantity: newSrcKnownQty,
          knownCostTotal: new Prisma.Decimal(newSrcKnownTotal),
          averageCost: newSrcAvgCost !== null ? new Prisma.Decimal(newSrcAvgCost) : null,
          lastUpdated: new Date(),
        },
      });

      if (destBalance) {
        const destTotalQty = destBalance.quantity;
        const destKnownQty = destBalance.knownCostQuantity ?? 0;
        const destKnownTotal = destBalance.knownCostTotal !== null ? Number(destBalance.knownCostTotal) : 0;

        const newDestTotal = destTotalQty + quantity;
        const newDestKnownQty = destKnownQty + transKnownQty;
        const newDestKnownTotal = destKnownTotal + transKnownValue;
        const newDestAvgCost = newDestKnownQty > 0 ? newDestKnownTotal / newDestKnownQty : null;

        await tx.inventoryBalance.update({
          where: { id: destBalance.id },
          data: {
            quantity: newDestTotal,
            knownCostQuantity: newDestKnownQty,
            knownCostTotal: new Prisma.Decimal(newDestKnownTotal),
            averageCost: newDestAvgCost !== null ? new Prisma.Decimal(newDestAvgCost) : null,
            lastUpdated: new Date(),
          },
        });
      } else {
        await tx.inventoryBalance.create({
          data: {
            productVariantId,
            inventoryAccountId: destinationAccountId,
            quantity,
            knownCostQuantity: transKnownQty,
            knownCostTotal: new Prisma.Decimal(transKnownValue),
            averageCost: transKnownQty > 0 ? new Prisma.Decimal(transKnownValue / transKnownQty) : null,
          },
        });
      }

      const costBasis = srcAvgCost;

      // 3. Create linked double-entry transactions
      const tx1 = await tx.inventoryTransaction.create({
        data: {
          productVariantId,
          inventoryAccountId: sourceAccountId,
          type: InventoryTransactionType.TRANSFER,
          quantity: -quantity,
          unitCost: costBasis !== null ? new Prisma.Decimal(costBasis) : null,
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
          unitCost: costBasis !== null ? new Prisma.Decimal(costBasis) : null,
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
    unitCost?: number | null;
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
      const curKnownQty = existingBalance ? (existingBalance.knownCostQuantity ?? 0) : 0;
      const curKnownTotal = existingBalance && existingBalance.knownCostTotal !== null ? Number(existingBalance.knownCostTotal) : 0;

      let newKnownQty = curKnownQty;
      let newKnownTotal = curKnownTotal;

      if (existingBalance) {
        const newQty = existingBalance.quantity + quantityChange;
        if (newQty < 0) {
          throw new DomainError("INSUFFICIENT_STOCK", "Adjustment would result in negative stock balance.");
        }

        if (quantityChange > 0) {
          if (unitCost !== undefined && unitCost !== null && unitCost > 0) {
            newKnownQty += quantityChange;
            newKnownTotal += quantityChange * unitCost;
          }
        } else if (quantityChange < 0) {
          const deductQty = Math.abs(quantityChange);
          const deductKnown = curKnownQty === existingBalance.quantity
            ? deductQty
            : Math.min(curKnownQty, Math.round(deductQty * (curKnownQty / (existingBalance.quantity || 1))));
          newKnownQty = Math.max(0, curKnownQty - deductKnown);
          const unitAvg = curKnownQty > 0 ? curKnownTotal / curKnownQty : 0;
          newKnownTotal = Math.max(0, curKnownTotal - (deductKnown * unitAvg));
        }

        const newAvgCost = newKnownQty > 0 ? newKnownTotal / newKnownQty : null;

        await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            quantity: newQty,
            knownCostQuantity: newKnownQty,
            knownCostTotal: new Prisma.Decimal(newKnownTotal),
            averageCost: newAvgCost !== null ? new Prisma.Decimal(newAvgCost) : null,
            lastUpdated: new Date(),
          },
        });
      } else {
        if (quantityChange < 0) {
          throw new DomainError("INSUFFICIENT_STOCK", "Adjustment would result in negative stock balance.");
        }
        const hasKnownCost = unitCost !== undefined && unitCost !== null && unitCost > 0;
        const knownQty = hasKnownCost ? quantityChange : 0;
        const knownTotal = hasKnownCost ? quantityChange * unitCost! : 0;

        await tx.inventoryBalance.create({
          data: {
            productVariantId,
            inventoryAccountId,
            quantity: quantityChange,
            knownCostQuantity: knownQty,
            knownCostTotal: new Prisma.Decimal(knownTotal),
            averageCost: hasKnownCost ? new Prisma.Decimal(unitCost!) : null,
          },
        });
      }

      const costBasis = (unitCost !== undefined && unitCost !== null && unitCost > 0)
        ? unitCost
        : (newKnownQty > 0 ? newKnownTotal / newKnownQty : null);

      // 2. Log transaction ledger entry
      await tx.inventoryTransaction.create({
        data: {
          productVariantId,
          inventoryAccountId,
          type,
          quantity: quantityChange,
          unitCost: costBasis !== null ? new Prisma.Decimal(costBasis) : null,
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

  /**
   * Intakes stock into the double-entry inventory ledger with atomic consistency.
   * Reuses Product, checks SKU collisions, updates or creates InventoryBalance,
   * enforces unknown-cost non-dilution, and logs immutable InventoryTransaction.
   */
  static async intakeStock(params: {
    actorId: string;
    actorName: string;
    setNumber: string;
    sku: string;
    condition?: ProductCondition;
    quantity: number;
    unitCost?: number | null;
    productName?: string;
    theme?: string;
    storageLocation?: string;
    supplier?: string;
    notes?: string;
    inventoryAccountId?: string;
  }) {
    const {
      actorId,
      actorName,
      setNumber,
      sku,
      condition = ProductCondition.NEW_SEALED,
      quantity,
      unitCost,
      productName,
      theme,
      storageLocation,
      supplier,
      notes,
      inventoryAccountId,
    } = params;

    if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
      throw new DomainError("VALIDATION_ERROR", "Intake quantity must be a positive integer.");
    }
    if (!sku || sku.trim().length === 0) {
      throw new DomainError("VALIDATION_ERROR", "SKU is required.");
    }
    if (!setNumber || setNumber.trim().length === 0) {
      throw new DomainError("VALIDATION_ERROR", "Set number is required.");
    }

    const cleanSku = sku.trim().toUpperCase();
    const cleanSetNumber = setNumber.trim().toUpperCase();

    return await prisma.$transaction(async (tx) => {
      // 1. Resolve or create Product entity
      let product = await tx.product.findUnique({
        where: { setNumber: cleanSetNumber },
      });

      if (!product) {
        product = await tx.product.create({
          data: {
            setNumber: cleanSetNumber,
            name: productName?.trim() || `LEGO Set ${cleanSetNumber}`,
            theme: theme?.trim() || "General",
            status: "ACTIVE",
          },
        });
      }

      // 2. Check SKU collision and resolve ProductVariant
      const existingVariant = await tx.productVariant.findUnique({
        where: { sku: cleanSku },
      });

      let variant: ProductVariant;
      if (existingVariant) {
        if (existingVariant.productId !== product.id) {
          throw new DomainError(
            "DUPLICATE_SKU",
            `SKU "${cleanSku}" is already assigned to a different product (variant ID: ${existingVariant.id}).`
          );
        }
        if (condition && existingVariant.condition !== condition) {
          throw new DomainError(
            "DUPLICATE_SKU",
            `SKU "${cleanSku}" already exists with condition ${existingVariant.condition}. Use a separate SKU for ${condition}.`
          );
        }
        variant = existingVariant;
      } else {
        variant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: cleanSku,
            condition,
            storageLocation: storageLocation?.trim() || null,
            notes: notes?.trim() || null,
            status: "ACTIVE",
          },
        });
      }

      // 3. Resolve target inventory account (default: COMPANY)
      let accountId = inventoryAccountId;
      if (!accountId) {
        const companyAcc = await tx.inventoryAccount.findFirst({
          where: { type: "COMPANY", status: "ACTIVE" },
        });
        if (!companyAcc) {
          throw new DomainError("ACCOUNT_NOT_FOUND", "Default company inventory account not found.");
        }
        accountId = companyAcc.id;
      }

      // 4. Lock balance row FOR UPDATE
      const balances = await tx.$queryRaw<InventoryBalance[]>`
        SELECT * FROM "InventoryBalance"
        WHERE "productVariantId" = ${variant.id}
          AND "inventoryAccountId" = ${accountId}
        LIMIT 1 FOR UPDATE
      `;

      const existingBalance = balances[0];
      const curQty = existingBalance?.quantity ?? 0;
      const curKnownQty = existingBalance?.knownCostQuantity ?? 0;
      const curKnownTotal = existingBalance && existingBalance.knownCostTotal !== null
        ? Number(existingBalance.knownCostTotal)
        : 0;

      const hasKnownCost = unitCost !== undefined && unitCost !== null && unitCost > 0;
      const newQty = curQty + quantity;
      let newKnownQty = curKnownQty;
      let newKnownTotal = curKnownTotal;

      if (hasKnownCost) {
        newKnownQty = curKnownQty + quantity;
        newKnownTotal = curKnownTotal + (quantity * unitCost!);
      }

      const newAvgCost = newKnownQty > 0 ? newKnownTotal / newKnownQty : null;

      let balance: InventoryBalance;
      if (existingBalance) {
        balance = await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            quantity: newQty,
            knownCostQuantity: newKnownQty,
            knownCostTotal: new Prisma.Decimal(newKnownTotal),
            averageCost: newAvgCost !== null ? new Prisma.Decimal(newAvgCost) : null,
            lastUpdated: new Date(),
          },
        });
      } else {
        balance = await tx.inventoryBalance.create({
          data: {
            productVariantId: variant.id,
            inventoryAccountId: accountId,
            quantity: newQty,
            knownCostQuantity: newKnownQty,
            knownCostTotal: new Prisma.Decimal(newKnownTotal),
            averageCost: newAvgCost !== null ? new Prisma.Decimal(newAvgCost) : null,
          },
        });
      }

      // 5. Commercial purchase record if supplier provided
      if (supplier && supplier.trim().length > 0) {
        const purchase = await tx.purchase.create({
          data: {
            supplier: supplier.trim(),
            purchaseDate: new Date(),
            status: "RECEIVED",
            totalCost: hasKnownCost ? new Prisma.Decimal(quantity * unitCost!) : new Prisma.Decimal(0),
            notes: notes || `Direct stock intake for ${cleanSku}`,
          },
        });

        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productVariantId: variant.id,
            inventoryAccountId: accountId,
            quantity,
            unitCost: hasKnownCost ? new Prisma.Decimal(unitCost!) : new Prisma.Decimal(0),
          },
        });
      }

      // 6. Double-entry ledger immutable transaction
      const transaction: InventoryTransaction = await tx.inventoryTransaction.create({
        data: {
          productVariantId: variant.id,
          inventoryAccountId: accountId,
          type: InventoryTransactionType.PURCHASE,
          quantity,
          unitCost: hasKnownCost ? new Prisma.Decimal(unitCost!) : null,
          actorType: ActorType.USER,
          actorId,
          actorName,
          notes: notes || (hasKnownCost ? `Stock intake @ €${unitCost!.toFixed(2)}` : "Stock intake with unknown cost basis"),
        },
      });

      // 7. Audit log
      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId,
          actorName,
          action: "INTAKE_STOCK",
          details: `Added ${quantity} units of ${cleanSku} (Set ${cleanSetNumber}) to inventory. Cost: ${hasKnownCost ? `€${unitCost!.toFixed(2)}/unit` : "Unknown"}.`,
        },
      });

      const costBasisStatus = this.getCostBasisStatus(balance);

      return {
        product,
        variant,
        balance,
        transaction,
        costBasisStatus: costBasisStatus.status,
      };
    });
  }

  /**
   * Helper to inspect and categorize inventory cost basis state.
   */
  static getCostBasisStatus(balance: {
    quantity: number;
    knownCostQuantity?: number | null;
    averageCost?: Prisma.Decimal | number | null;
  }): {
    status: "FULLY_KNOWN" | "PARTIALLY_KNOWN" | "COMPLETELY_UNKNOWN";
    knownQuantity: number;
    totalQuantity: number;
    averageKnownCost: number | null;
  } {
    const totalQty = balance.quantity;
    const knownQty = balance.knownCostQuantity ?? (balance.averageCost ? totalQty : 0);
    const avgCost = balance.averageCost !== null && balance.averageCost !== undefined ? Number(balance.averageCost) : null;

    if (totalQty === 0 || knownQty === 0 || avgCost === null) {
      return { status: "COMPLETELY_UNKNOWN", knownQuantity: 0, totalQuantity: totalQty, averageKnownCost: null };
    }
    if (knownQty >= totalQty) {
      return { status: "FULLY_KNOWN", knownQuantity: totalQty, totalQuantity: totalQty, averageKnownCost: avgCost };
    }
    return { status: "PARTIALLY_KNOWN", knownQuantity: knownQty, totalQuantity: totalQty, averageKnownCost: avgCost };
  }
}

// Simple internal formatter helper
const fmt = (val: number) => {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(val);
};
