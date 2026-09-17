import { prisma, pool } from "@/lib/prisma";
import {
  MarketplaceType,
  SyncOperation,
  SyncStatus,
  SyncJob,
  AlertType,
  ProductCondition,
} from "@prisma/client";
import { executeJob } from "@/worker";

describe("Worker Operations & Concurrency Tests", () => {
  let testJobId: string;

  beforeEach(async () => {
    // Ensure SHOPIFY is in DEMO mode for test baseline
    await prisma.marketplace.upsert({
      where: { id: MarketplaceType.SHOPIFY },
      update: { mode: "DEMO" },
      create: {
        id: MarketplaceType.SHOPIFY,
        name: "Shopify Store",
        mode: "DEMO",
        status: "CONNECTED",
      },
    });

    const job = await prisma.syncJob.create({
      data: {
        marketplace: MarketplaceType.SHOPIFY,
        operation: SyncOperation.SYNC_INVENTORY,
        status: SyncStatus.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date(),
      },
    });
    testJobId = job.id;
  });

  afterEach(async () => {
    await prisma.syncJob.deleteMany({
      where: { id: testJobId },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  test("Concurrency verification: Two workers running claiming query concurrently must never claim the same job", async () => {
    const claimQuery = `
      UPDATE "SyncJob"
      SET "status" = 'PROCESSING',
          "lockedAt" = NOW(),
          "lockedBy" = $1,
          "attemptCount" = "attemptCount" + 1,
          "startedAt" = NOW()
      WHERE "id" = (
        SELECT "id"
        FROM "SyncJob"
        WHERE "id" = $2
          AND ("status" = 'PENDING' OR "status" = 'FAILED' OR "status" = 'RETRYING')
          AND "attemptCount" < 5
          AND "nextAttemptAt" <= NOW()
          AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '5 minutes')
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    // Fire two claim operations concurrently
    const [result1, result2] = await Promise.all([
      prisma.$queryRawUnsafe<SyncJob[]>(claimQuery, "worker-thread-A", testJobId),
      prisma.$queryRawUnsafe<SyncJob[]>(claimQuery, "worker-thread-B", testJobId),
    ]);

    const claimedByA = result1.length > 0;
    const claimedByB = result2.length > 0;

    expect(claimedByA !== claimedByB).toBe(true);

    if (claimedByA) {
      expect(result1[0].lockedBy).toBe("worker-thread-A");
      expect(result2.length).toBe(0);
    } else {
      expect(result2[0].lockedBy).toBe("worker-thread-B");
      expect(result1.length).toBe(0);
    }

    const dbJob = await prisma.syncJob.findUnique({
      where: { id: testJobId },
    });
    expect(dbJob).not.toBeNull();
    expect(dbJob?.status).toBe(SyncStatus.PROCESSING);
    expect(dbJob?.attemptCount).toBe(1);
    expect(["worker-thread-A", "worker-thread-B"]).toContain(dbJob?.lockedBy);
  });

  test("REFRESH_PRICE_OBSERVATIONS: Executes price observation refresh and records resultSummary", async () => {
    // Create test product and variant
    const product = await prisma.product.create({
      data: {
        setNumber: `W-10330-${Date.now()}`,
        name: "Worker Test Set",
        theme: "Icons",
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `SKU-WORKER-${Date.now()}`,
        condition: ProductCondition.NEW_SEALED,
      },
    });

    const refreshJob = await prisma.syncJob.create({
      data: {
        marketplace: MarketplaceType.CATAWIKI,
        operation: SyncOperation.REFRESH_PRICE_OBSERVATIONS,
        status: SyncStatus.PROCESSING,
        attemptCount: 1,
        productVariantId: variant.id,
      },
    });

    try {
      await executeJob(refreshJob);

      const completedJob = await prisma.syncJob.findUnique({
        where: { id: refreshJob.id },
      });

      expect(completedJob?.status).toBe(SyncStatus.SUCCESS);
      expect(completedJob?.resultSummary).toBeDefined();
      expect(completedJob?.resultSummary).toContain("Refreshed");
      expect(completedJob?.completedAt).not.toBeNull();
    } finally {
      await prisma.syncJob.deleteMany({ where: { id: refreshJob.id } });
      await prisma.alert.deleteMany({ where: { productVariantId: variant.id } });
      await prisma.priceRecommendation.deleteMany({ where: { productVariantId: variant.id } });
      await prisma.productVariant.deleteMany({ where: { id: variant.id } });
      await prisma.product.deleteMany({ where: { id: product.id } });
    }
  });

  test("RECONCILE: Detects discrepancies between local listings and remote adapter, raising alerts", async () => {
    const timestamp = Date.now();
    const product = await prisma.product.create({
      data: {
        setNumber: `REC-${timestamp}`,
        name: "Reconciliation Test Set",
        theme: "Speed Champions",
      },
    });

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `SKU-REC-${timestamp}`,
        condition: ProductCondition.NEW_SEALED,
      },
    });

    const account = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY" },
    });

    if (!account) {
      throw new Error("No company inventory account found for reconciliation test.");
    }

    // Local balance: 3 units
    await prisma.inventoryBalance.create({
      data: {
        productVariantId: variant.id,
        inventoryAccountId: account.id,
        quantity: 3,
        knownCostQuantity: 3,
        knownCostTotal: 90.0,
      },
    });

    // Create a local listing with mismatched price or external ID
    const listing = await prisma.marketplaceListing.create({
      data: {
        productVariantId: variant.id,
        marketplace: MarketplaceType.SHOPIFY,
        externalListingId: `ext-${timestamp}`,
        price: 49.99,
        quantity: 3,
        status: "ACTIVE",
      },
    });

    const reconcileJob = await prisma.syncJob.create({
      data: {
        marketplace: MarketplaceType.SHOPIFY,
        operation: SyncOperation.RECONCILE,
        status: SyncStatus.PROCESSING,
        attemptCount: 1,
        productVariantId: variant.id,
      },
    });

    try {
      await executeJob(reconcileJob);

      const completedJob = await prisma.syncJob.findUnique({
        where: { id: reconcileJob.id },
      });

      expect(completedJob?.status).toBe(SyncStatus.SUCCESS);
      expect(completedJob?.resultSummary).toBeDefined();
      expect(completedJob?.resultSummary).toContain("Reconciliation");

      // Verify that reconciliation raised an alert for discrepancy
      const alert = await prisma.alert.findFirst({
        where: {
          productVariantId: variant.id,
          type: AlertType.RECONCILIATION_DISCREPANCY,
        },
      });
      expect(alert).not.toBeNull();
      expect(alert?.type).toBe(AlertType.RECONCILIATION_DISCREPANCY);
    } finally {
      await prisma.alert.deleteMany({ where: { productVariantId: variant.id } });
      await prisma.syncJob.deleteMany({ where: { id: reconcileJob.id } });
      await prisma.marketplaceListing.deleteMany({ where: { id: listing.id } });
      await prisma.inventoryBalance.deleteMany({ where: { productVariantId: variant.id } });
      await prisma.productVariant.deleteMany({ where: { id: variant.id } });
      await prisma.product.deleteMany({ where: { id: product.id } });
    }
  });

  test("EXTERNAL_AUTH_FAILURE: Raises critical alert when credentials are missing in REAL mode", async () => {
    // Switch SHOPIFY to REAL mode without valid credentials
    await prisma.marketplace.update({
      where: { id: MarketplaceType.SHOPIFY },
      data: { mode: "REAL", credentialsJson: null },
    });

    const failedAuthJob = await prisma.syncJob.create({
      data: {
        marketplace: MarketplaceType.SHOPIFY,
        operation: SyncOperation.RECONCILE,
        status: SyncStatus.PROCESSING,
        attemptCount: 1,
      },
    });

    try {
      await executeJob(failedAuthJob);

      const updatedJob = await prisma.syncJob.findUnique({
        where: { id: failedAuthJob.id },
      });
      // Should be retrying
      expect(updatedJob?.status).toBe(SyncStatus.RETRYING);

      // Verify EXTERNAL_AUTH_FAILURE alert was raised
      const authAlert = await prisma.alert.findFirst({
        where: {
          type: AlertType.EXTERNAL_AUTH_FAILURE,
          message: { contains: "SHOPIFY" },
        },
      });
      expect(authAlert).not.toBeNull();
      expect(authAlert?.severity).toBe("CRITICAL");
    } finally {
      await prisma.syncJob.deleteMany({ where: { id: failedAuthJob.id } });
      await prisma.alert.deleteMany({ where: { type: AlertType.EXTERNAL_AUTH_FAILURE } });
      // Reset back to DEMO
      await prisma.marketplace.update({
        where: { id: MarketplaceType.SHOPIFY },
        data: { mode: "DEMO" },
      });
    }
  });
});
