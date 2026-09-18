"use server";

import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole, MarketplaceType, ActorType, Prisma, InventoryBalance, ProductCondition, EventStatus, SyncStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { ShopifyAdapter } from "@/services/marketplace/shopify";
import { BolAdapter } from "@/services/marketplace/bol";
import { CatawikiAdapter } from "@/services/marketplace/catawiki";

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
    const cleanCredentials: Record<string, string> = {};
    if (type === MarketplaceType.SHOPIFY) {
      if (credentials.shopName) cleanCredentials.shopName = credentials.shopName;
    } else if (type === MarketplaceType.BOL) {
      if (credentials.clientId) cleanCredentials.clientId = credentials.clientId;
    }
    const credString = JSON.stringify(cleanCredentials);

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
          const oldKnownQty = existing.knownCostQuantity ?? 0;
          const oldKnownTotal = existing.knownCostTotal !== null ? Number(existing.knownCostTotal) : 0;
          const newQty = oldQty + item.quantity;
          const avgCost = oldKnownQty > 0 ? oldKnownTotal / oldKnownQty : null;

          await tx.inventoryBalance.update({
            where: { id: existing.id },
            data: {
              quantity: newQty,
              knownCostQuantity: oldKnownQty,
              knownCostTotal: new Prisma.Decimal(oldKnownTotal),
              averageCost: avgCost !== null ? new Prisma.Decimal(avgCost) : null,
              lastUpdated: new Date(),
            },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              productVariantId: variant.id,
              inventoryAccountId: params.inventoryAccountId,
              quantity: item.quantity,
              knownCostQuantity: 0,
              knownCostTotal: new Prisma.Decimal(0.00),
              averageCost: null,
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
            unitCost: null, // Unknown acquisition cost (do not fabricate)
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

/**
 * Tests connection settings for a given marketplace adapter without persisting them.
 */
export async function testMarketplaceConnectionAction(
  type: MarketplaceType,
  mode: "REAL" | "DEMO",
  credentials: Record<string, string>
) {
  await checkRole([UserRole.ADMIN]);

  try {
    const mergedCredentials: Record<string, string> = {};
    if (type === MarketplaceType.SHOPIFY) {
      mergedCredentials.shopName = credentials.shopName || process.env.SHOPIFY_STORE_DOMAIN || "";
      mergedCredentials.accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
      mergedCredentials.webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
    } else if (type === MarketplaceType.BOL) {
      mergedCredentials.clientId = credentials.clientId || "";
      mergedCredentials.clientSecret = process.env.BOL_CLIENT_SECRET || "";
    }

    const credentialsJson = JSON.stringify(mergedCredentials);
    
    let adapter;
    if (type === MarketplaceType.SHOPIFY) {
      adapter = new ShopifyAdapter(mode, credentialsJson);
    } else if (type === MarketplaceType.BOL) {
      adapter = new BolAdapter(mode, credentialsJson);
    } else {
      adapter = new CatawikiAdapter(mode, credentialsJson);
    }

    const testResult = await adapter.testConnection();
    return testResult;
  } catch (err) {
    console.error("Test connection failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Connection verification failed.";
    return { success: false, error: errorMsg };
  }
}

/**
 * Resolves an unmatched SKU alert by mapping it to a variant and reprocessing.
 */
export async function resolveUnmatchedSkuAction(
  alertId: string,
  variantId: string,
  resolutionType: "PERMANENT" | "ONE_TIME"
) {
  const user = await checkRole([UserRole.ADMIN]);

  try {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert || alert.resolved) {
      throw new Error("Alert not found or already resolved.");
    }

    const parts = alert.message.split(" | ");
    const eventIdPart = parts.find((p) => p.startsWith("Event:"));
    const skuPart = parts.find((p) => p.startsWith("SKU:"));

    if (!eventIdPart || !skuPart) {
      throw new Error("Alert message is not in expected structured format.");
    }

    const eventId = eventIdPart.replace("Event:", "").trim();
    const unmatchedSku = skuPart.replace("SKU:", "").trim();

    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });

    if (!variant) {
      throw new Error("Target product variant not found.");
    }

    if (resolutionType === "PERMANENT") {
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { sku: unmatchedSku },
      });

      await prisma.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId: user.id,
          actorName: user.name,
          action: "RESOLVE_SKU_PERMANENT",
          details: `Mapped variant ${variant.product.name} (${variant.product.setNumber}) permanently to SKU: ${unmatchedSku}`,
        },
      });
    } else {
      const event = await prisma.marketplaceEvent.findUnique({
        where: { id: eventId },
      });

      if (!event || !event.payload) {
        throw new Error("Associated marketplace event or payload not found.");
      }

      const payload = JSON.parse(event.payload);
      if (payload.line_items) {
        for (const item of payload.line_items) {
          if (!item.sku || item.sku === unmatchedSku) {
            item.sku = variant.sku;
          }
        }
      }

      await prisma.marketplaceEvent.update({
        where: { id: eventId },
        data: {
          payload: JSON.stringify(payload),
          processingStatus: EventStatus.PENDING,
          failureReason: null,
        },
      });

      await prisma.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId: user.id,
          actorName: user.name,
          action: "RESOLVE_SKU_ONETIME",
          details: `Mapped Shopify event ${eventId} line items temporarily to catalog SKU: ${variant.sku}`,
        },
      });
    }

    const { MarketplaceEventProcessor } = await import("@/services/marketplace/eventProcessor");
    
    if (resolutionType === "PERMANENT") {
      await prisma.marketplaceEvent.update({
        where: { id: eventId },
        data: {
          processingStatus: EventStatus.PENDING,
          failureReason: null,
        },
      });
    }

    const reprocessResult = await MarketplaceEventProcessor.processEvent(eventId);

    if (!reprocessResult.success) {
      throw new Error(`Reprocessing failed: ${reprocessResult.error}`);
    }

    await prisma.alert.update({
      where: { id: alertId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
      },
    });

    revalidatePath("/alerts");
    revalidatePath("/");
    return { success: true as const };
  } catch (err) {
    console.error("Resolve unmatched SKU failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to resolve unmatched SKU.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Retries a failed or pending synchronization job manually.
 */
export async function retrySyncJobAction(jobId: string) {
  await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    const job = await prisma.syncJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error("Job not found.");
    }

    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: SyncStatus.PENDING,
        attemptNumber: 1,
        errorDetails: null,
      },
    });

    const { SyncService } = await import("@/services/marketplace/syncService");
    const result = await SyncService.processJob(jobId);

    revalidatePath("/marketplaces");
    return { success: result.success, error: result.error };
  } catch (err) {
    console.error("Retry sync job failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to retry synchronization job.";
    return { success: false, error: errorMsg };
  }
}

/**
 * Resolves a reconciliation mismatch by pushing central quantity to Shopify.
 */
export async function triggerOutboundSyncAction(productVariantId: string) {
  await checkRole([UserRole.ADMIN]);

  try {
    const { SyncService } = await import("@/services/marketplace/syncService");
    await SyncService.queueAndTriggerSync(productVariantId);
    return { success: true as const };
  } catch (err) {
    console.error("Failed to trigger outbound sync:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to queue sync job.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Resolves a reconciliation mismatch by correcting local stock level.
 */
export async function resolveReconciliationCorrectionAction(params: {
  productVariantId: string;
  quantityChange: number;
  notes?: string;
}) {
  const user = await checkRole([UserRole.ADMIN]);

  try {
    const companyAccount = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY", status: "ACTIVE" },
    });

    if (!companyAccount) {
      throw new Error("No active Company inventory account found.");
    }

    const { InventoryService } = await import("@/services/inventoryService");
    
    await InventoryService.adjustStock({
      actorId: user.id,
      actorName: user.name,
      productVariantId: params.productVariantId,
      inventoryAccountId: companyAccount.id,
      type: "STOCK_COUNT_CORRECTION",
      quantityChange: params.quantityChange,
      notes: params.notes || "Reconciliation discrepancy adjustment correction.",
    });

    const { SyncService } = await import("@/services/marketplace/syncService");
    await SyncService.queueAndTriggerSync(params.productVariantId);

    revalidatePath("/marketplaces/shopify/reconciliation");
    revalidatePath("/");
    return { success: true as const };
  } catch (err) {
    console.error("Reconciliation correction failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to resolve mismatch.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Accepts a pricing recommendation, updates local listing prices, logs an audit trail, and schedules updates.
 */
export async function acceptPriceRecommendationAction(recommendationId: string) {
  const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    const recommendation = await prisma.priceRecommendation.findUnique({
      where: { id: recommendationId },
      include: {
        productVariant: {
          include: {
            product: true,
            listings: true,
          },
        },
      },
    });

    if (!recommendation) {
      throw new Error("Pricing recommendation not found.");
    }

    const { productVariant } = recommendation;

    await prisma.$transaction(async (tx) => {
      await tx.marketplaceListing.updateMany({
        where: { productVariantId: productVariant.id },
        data: {
          price: recommendation.recommendedPrice,
          lastSyncedAt: new Date(),
        },
      });

      for (const listing of productVariant.listings) {
        await tx.syncJob.create({
          data: {
            marketplace: listing.marketplace,
            operation: "SYNC_PRICE",
            productVariantId: productVariant.id,
            status: SyncStatus.PENDING,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId: user.id,
          actorName: user.name,
          action: "ACCEPT_PRICE_RECOMMENDATION",
          details: `Accepted price recommendation of €${Number(recommendation.recommendedPrice).toFixed(2)} for ${productVariant.product.name} (Set: ${productVariant.product.setNumber}, SKU: ${productVariant.sku}).`,
        },
      });

      await tx.priceRecommendation.delete({
        where: { id: recommendationId },
      });
    });

    revalidatePath("/pricing");
    revalidatePath(`/inventory/${productVariant.id}`);
    revalidatePath("/");
    return { success: true as const };
  } catch (err) {
    console.error("Failed to accept price recommendation:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to accept pricing suggestion.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Triggers the Pricing Engine calculation for a specific variant or full inventory sweep.
 */
export async function runPricingEngineAction(variantId?: string) {
  await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    const { PriceEngineService } = await import("@/services/pricing/priceEngineService");
    
    if (variantId) {
      const res = await PriceEngineService.evaluateVariant(variantId);
      revalidatePath("/pricing");
      revalidatePath("/alerts");
      return { success: true as const, data: res };
    }

    const sweep = await PriceEngineService.runFullPricingSweep(40);
    revalidatePath("/pricing");
    revalidatePath("/alerts");
    revalidatePath("/");
    return { success: true as const, data: sweep };
  } catch (err) {
    console.error("Run pricing engine action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Pricing engine calculation failed.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Refreshes live market auction observations from Catawiki for a set.
 */
export async function refreshMarketPricesAction(setNumber: string) {
  await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);

  try {
    const { CatawikiScraperService } = await import("@/services/scraper/catawikiScraper");
    const res = await CatawikiScraperService.refreshSetPrices(setNumber);

    if (res.success) {
      // Re-run pricing evaluation for any variant associated with this set
      const product = await prisma.product.findUnique({
        where: { setNumber },
        include: { variants: true }
      });

      if (product && product.variants.length > 0) {
        const { PriceEngineService } = await import("@/services/pricing/priceEngineService");
        await PriceEngineService.evaluateVariant(product.variants[0].id);
      }
    }

    revalidatePath("/pricing");
    revalidatePath("/alerts");
    return res;
  } catch (err) {
    console.error("Refresh market prices action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to refresh market prices.";
    return { success: false as const, error: errorMsg, count: 0 };
  }
}

/**
 * Researches the market price of ANY LEGO set number manually.
 * Separated strictly from inventory ownership (does not create stock or balances).
 */
export async function researchLegoSetAction(params: {
  setNumber: string;
  hypotheticalCost?: number | null;
  targetChannel?: string;
  forceRefresh?: boolean;
  userProductName?: string;
  userTheme?: string;
}) {
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (!user) {
      return { success: false as const, error: "Unauthorized: Please log in to perform market research." };
    }

    const { MarketResearchService } = await import("@/services/pricing/marketResearchService");
    const rawInput = (params.setNumber || "").trim();
    if (!rawInput || rawInput.length < 3) {
      return {
        success: false as const,
        error: "Invalid LEGO set number or identifier. Please enter a valid set number, part ID, SKU, or EAN.",
      };
    }

    // Force-refreshing external market scrapers requires ADMIN or FAMILY_SELLER
    const canRefresh = user.role === UserRole.ADMIN || user.role === UserRole.FAMILY_SELLER;
    const forceRefresh = params.forceRefresh && canRefresh ? true : false;

    const result = await MarketResearchService.researchLegoSet({
      ...params,
      setNumber: rawInput,
      forceRefresh
    });

    return { success: true as const, data: result };
  } catch (err) {
    console.error("Research LEGO set action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Market research failed.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Retrieves recent LEGO set market research sessions.
 */
export async function getRecentResearchAction(limit: number = 6) {
  try {
    const { MarketResearchService } = await import("@/services/pricing/marketResearchService");
    const data = await MarketResearchService.getRecentResearches(limit);
    return { success: true as const, data };
  } catch (err) {
    console.error("Get recent research action failed:", err);
    return { success: false as const, error: "Failed to load recent research history.", data: [] };
  }
}

/**
 * Adds a researched LEGO set directly to real inventory using the ledger.
 * RBAC: ADMIN or FAMILY_SELLER only.
 */
export async function addResearchedSetToInventoryAction(params: {
  setNumber: string;
  sku: string;
  condition: ProductCondition;
  quantity: number;
  unitCost?: number | null;
  storageLocation?: string;
  notes?: string;
  supplier?: string;
  productName?: string;
  theme?: string;
}) {
  try {
    const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);
    const { InventoryService } = await import("@/services/inventoryService");
    const result = await InventoryService.intakeStock({
      actorId: user.id,
      actorName: user.name,
      setNumber: params.setNumber,
      sku: params.sku,
      condition: params.condition,
      quantity: params.quantity,
      unitCost: params.unitCost,
      productName: params.productName,
      theme: params.theme,
      storageLocation: params.storageLocation,
      notes: params.notes,
      supplier: params.supplier,
    });

    // Evaluate pricing for the new inventory variant
    try {
      const { PriceEngineService } = await import("@/services/pricing/priceEngineService");
      await PriceEngineService.evaluateVariant(result.variant.id);
    } catch (pricingErr) {
      console.warn("Pricing evaluation after intake warning:", pricingErr);
    }

    revalidatePath("/pricing");
    revalidatePath("/inventory");
    revalidatePath("/analytics");
    revalidatePath("/");

    return {
      success: true as const,
      data: {
        productId: result.product.id,
        variantId: result.variant.id,
        sku: result.variant.sku,
        quantity: result.balance.quantity,
        costBasisStatus: result.costBasisStatus,
      },
    };
  } catch (err) {
    console.error("Add researched set to inventory failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to add set to inventory.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Direct manual stock intake (+ Add LEGO / Stock) without prior research.
 * RBAC: ADMIN or FAMILY_SELLER only.
 */
export async function addManualLegoStockAction(params: {
  setNumber: string;
  sku: string;
  condition: ProductCondition;
  quantity: number;
  unitCost?: number | null;
  productName?: string;
  theme?: string;
  storageLocation?: string;
  supplier?: string;
  notes?: string;
}) {
  try {
    const user = await checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER]);
    const { InventoryService } = await import("@/services/inventoryService");
    const intakeResult = await InventoryService.intakeStock({
      actorId: user.id,
      actorName: user.name,
      setNumber: params.setNumber,
      sku: params.sku,
      condition: params.condition,
      quantity: params.quantity,
      unitCost: params.unitCost,
      productName: params.productName,
      theme: params.theme,
      storageLocation: params.storageLocation,
      supplier: params.supplier,
      notes: params.notes,
    });

    // Automatically trigger market research and pricing engine sweep for the new item
    let researchData = null;
    try {
      const { MarketResearchService } = await import("@/services/pricing/marketResearchService");
      researchData = await MarketResearchService.researchLegoSet({
        setNumber: params.setNumber,
        hypotheticalCost: params.unitCost,
        forceRefresh: false,
        userProductName: params.productName,
        userTheme: params.theme,
      });

      const { PriceEngineService } = await import("@/services/pricing/priceEngineService");
      await PriceEngineService.evaluateVariant(intakeResult.variant.id);
    } catch (auxErr) {
      console.warn("Post-intake research or pricing warning:", auxErr);
    }

    revalidatePath("/pricing");
    revalidatePath("/inventory");
    revalidatePath("/analytics");
    revalidatePath("/");

    return {
      success: true as const,
      data: {
        product: intakeResult.product,
        variant: intakeResult.variant,
        balance: intakeResult.balance,
        research: researchData,
      },
    };
  } catch (err) {
    console.error("Add manual stock action failed:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to record manual LEGO stock.";
    return { success: false as const, error: errorMsg };
  }
}

/**
 * Safe diagnostic action for evaluating live Catawiki integration.
 * ADMIN ONLY. Never returns secrets or credentials.
 */
export async function testCatawikiDiagnosticsAction(identifier: string) {
  await checkRole([UserRole.ADMIN]);

  const cleanId = (identifier || "10316").trim();

  try {
    const { ProductIdentificationService } = await import("@/services/catalog/productIdentificationService");
    const resolved = await ProductIdentificationService.resolveProduct(cleanId);

    const { CatawikiScraperService } = await import("@/services/scraper/catawikiScraper");
    const { lots, telemetry } = await CatawikiScraperService.fetchMarketObservationsWithTelemetry({
      identifier: resolved.canonicalIdentifier || cleanId,
      productName: resolved.name,
      identifierType: resolved.identifierType,
    });

    const sampleAcceptedResults = lots.slice(0, 5).map(lot => ({
      title: lot.title,
      price: lot.price,
      priceType: lot.priceType,
      capturedDate: lot.capturedAt.toISOString(),
      catawikiUrl: lot.externalUrl || "",
      provenance: lot.provenance,
    }));

    return {
      success: true as const,
      diagnostics: {
        configured: telemetry.configured,
        provider: telemetry.provider,
        actor: telemetry.actor,
        requestExecuted: telemetry.requestExecuted,
        requestSuccessful: telemetry.requestSuccessful,
        responseStatus: telemetry.responseStatus,
        query: cleanId,
        queriesAttempted: telemetry.queriesAttempted,
        rawResultCount: telemetry.rawResultCount,
        acceptedResultCount: telemetry.acceptedResultCount,
        rejectedResultCount: telemetry.rejectedResultCount,
        rejectionReasonCounts: telemetry.rejectionReasonCounts,
        rejectionDetails: telemetry.rejectionDetails?.slice(0, 10),
        durationMs: telemetry.durationMs,
        status: telemetry.status,
        errorCode: telemetry.errorCode,
        errorMessage: telemetry.errorMessage,
        sampleAcceptedResults,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false as const,
      error: errorMsg,
      diagnostics: {
        configured: Boolean(process.env.APIFY_API_TOKEN),
        provider: "catawiki",
        actor: process.env.APIFY_ACTOR_ID || "saswave~catawiki-scraper",
        requestExecuted: false,
        requestSuccessful: false,
        responseStatus: null,
        query: cleanId,
        queriesAttempted: [],
        rawResultCount: 0,
        acceptedResultCount: 0,
        rejectedResultCount: 0,
        rejectionReasonCounts: {},
        durationMs: 0,
        status: "PROVIDER_FAILED" as const,
        errorCode: "DIAGNOSTIC_EXCEPTION",
        errorMessage: errorMsg,
      },
    };
  }
}



