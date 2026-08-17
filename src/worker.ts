/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient, SyncOperation, SyncStatus, AlertType, AlertSeverity, SyncJob } from "@prisma/client";
import crypto from "crypto";
import { MarketplaceFactory } from "./services/marketplace/factory";

const prisma = new PrismaClient();

const WORKER_ID = `worker-${crypto.randomUUID()}`;
const LOCK_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_SECONDS = 30;

let isShuttingDown = false;
const activeJobs = new Set<Promise<void>>();

// Polling interval reference
let pollTimeout: NodeJS.Timeout | null = null;

async function executeJob(job: SyncJob): Promise<void> {
  console.log(`[Worker ${WORKER_ID}] Starting job ${job.id} (Op: ${job.operation}, Attempt: ${job.attemptCount})`);
  
  try {
    switch (job.operation) {
      case SyncOperation.SYNC_INVENTORY: {
        if (!job.productVariantId) {
          throw new Error("Job is missing productVariantId.");
        }
        
        // 1. Fetch variant details
        const variant = await prisma.productVariant.findUnique({
          where: { id: job.productVariantId },
          include: { product: true },
        });

        if (!variant) {
          throw new Error(`Variant ${job.productVariantId} not found in catalog.`);
        }

        // 2. Aggregate central Company stock balance
        const companyBalances = await prisma.inventoryBalance.findMany({
          where: {
            productVariantId: job.productVariantId,
            inventoryAccount: { type: "COMPANY" },
          },
        });

        const totalQuantity = companyBalances.reduce((sum, b) => sum + b.quantity, 0);

        // 3. Invoke Marketplace Adapter
        const adapter = await MarketplaceFactory.getAdapter(job.marketplace);
        const result = await adapter.syncInventory(variant.sku, totalQuantity, job.id);

        if (!result.success) {
          throw new Error(result.error || "Adapter reported inventory sync failure.");
        }
        break;
      }

      case SyncOperation.SYNC_PRICE: {
        if (!job.productVariantId) {
          throw new Error("Job is missing productVariantId.");
        }
        const listing = await prisma.marketplaceListing.findFirst({
          where: { productVariantId: job.productVariantId, marketplace: job.marketplace },
        });
        if (!listing) {
          throw new Error(`No listing found for variant ${job.productVariantId} on ${job.marketplace}`);
        }
        const adapter = await MarketplaceFactory.getAdapter(job.marketplace);
        const result = await (adapter as any).updatePrice(listing.externalListingId, Number(listing.price));
        if (!result.success) {
          throw new Error(result.error || "Price update failed.");
        }
        break;
      }

      case SyncOperation.REFRESH_PRICE_OBSERVATIONS:
        console.log(`[Worker ${WORKER_ID}] Price observations refresh placeholder executed successfully for job ${job.id}`);
        break;

      case SyncOperation.RECONCILE:
        console.log(`[Worker ${WORKER_ID}] Inventory reconciliation placeholder executed successfully for job ${job.id}`);
        break;

      default:
        throw new Error(`Unsupported sync operation: ${job.operation}`);
    }

    // Success State Update
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncStatus.SUCCESS,
        completedAt: new Date(),
        errorDetails: null,
        lockedAt: null,
        lockedBy: null,
      },
    });

    console.log(`[Worker ${WORKER_ID}] Job ${job.id} completed successfully.`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Execution failed.";
    console.error(`[Worker ${WORKER_ID}] Job ${job.id} failed:`, errorMsg);

    const isFinalFailure = job.attemptCount >= MAX_ATTEMPTS;

    if (isFinalFailure) {
      // Dead-letter state: set to FAILED and raise system alert
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: SyncStatus.FAILED,
          completedAt: new Date(),
          errorDetails: errorMsg,
          lockedAt: null,
          lockedBy: null,
        },
      });

      await prisma.alert.create({
        data: {
          productVariantId: job.productVariantId,
          type: AlertType.SYNC_ERROR,
          severity: AlertSeverity.CRITICAL,
          message: `SYNC_ERROR | Worker failed job ${job.id} (${job.operation}) permanently after ${job.attemptCount} attempts. Error: ${errorMsg}`,
        },
      });

      console.error(`[Worker ${WORKER_ID}] Job ${job.id} permanently failed. Alert raised.`);
    } else {
      // Exponential Backoff calculation: 2^attemptCount * BACKOFF_BASE_SECONDS
      const backoffSeconds = Math.pow(2, job.attemptCount) * BACKOFF_BASE_SECONDS;
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: SyncStatus.RETRYING,
          nextAttemptAt,
          errorDetails: errorMsg,
          lockedAt: null,
          lockedBy: null,
        },
      });

      console.log(`[Worker ${WORKER_ID}] Job ${job.id} scheduled for retry in ${backoffSeconds}s at ${nextAttemptAt.toISOString()}`);
    }
  }
}

async function reclaimAbandonedLocks(): Promise<void> {
  try {
    const expirationTime = new Date(Date.now() - LOCK_EXPIRATION_MS);

    // Reclaim stuck jobs
    const result = await prisma.syncJob.updateMany({
      where: {
        status: SyncStatus.PROCESSING,
        lockedAt: {
          lt: expirationTime,
        },
      },
      data: {
        status: SyncStatus.RETRYING,
        lockedAt: null,
        lockedBy: null,
        errorDetails: "Lock abandoned or worker crashed.",
      },
    });

    if (result.count > 0) {
      console.log(`[Worker ${WORKER_ID}] Reclaimed ${result.count} abandoned locks.`);
    }
  } catch (err) {
    console.error(`[Worker ${WORKER_ID}] Failed to reclaim abandoned locks:`, err);
  }
}

async function pollAndProcess(): Promise<void> {
  if (isShuttingDown) return;

  try {
    // 1. Periodically reclaim abandoned locks
    await reclaimAbandonedLocks();

    // 2. Atomically claim a single job using FOR UPDATE SKIP LOCKED
    const claimed: SyncJob[] = await prisma.$queryRawUnsafe<SyncJob[]>(`
      UPDATE "SyncJob"
      SET "status" = 'PROCESSING',
          "lockedAt" = NOW(),
          "lockedBy" = $1,
          "attemptCount" = "attemptCount" + 1,
          "startedAt" = NOW()
      WHERE "id" = (
        SELECT "id"
        FROM "SyncJob"
        WHERE ("status" = 'PENDING' OR "status" = 'FAILED' OR "status" = 'RETRYING')
          AND "attemptCount" < $2
          AND "nextAttemptAt" <= NOW()
          AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '5 minutes')
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `, WORKER_ID, MAX_ATTEMPTS);

    if (claimed.length > 0) {
      const job = claimed[0];
      const jobPromise = executeJob(job).finally(() => {
        activeJobs.delete(jobPromise);
      });
      activeJobs.add(jobPromise);
    }
  } catch (err) {
    console.error(`[Worker ${WORKER_ID}] Error in polling cycle:`, err);
  }

  if (!isShuttingDown) {
    pollTimeout = setTimeout(pollAndProcess, 1000);
  }
}

function handleShutdown(signal: string) {
  console.log(`[Worker ${WORKER_ID}] Received ${signal}. Shutting down gracefully...`);
  isShuttingDown = true;
  
  if (pollTimeout) {
    clearTimeout(pollTimeout);
  }

  // Set timeout to force exit if active jobs take too long
  const forceExitTimeout = setTimeout(() => {
    console.error(`[Worker ${WORKER_ID}] Active jobs failed to terminate within shutdown window. Forcing exit.`);
    process.exit(1);
  }, 10000);

  Promise.all(Array.from(activeJobs)).finally(async () => {
    clearTimeout(forceExitTimeout);
    await prisma.$disconnect();
    console.log(`[Worker ${WORKER_ID}] Graceful shutdown completed. Exiting.`);
    process.exit(0);
  });
}

// Bind process signals
process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

// Start polling
console.log(`[Worker ${WORKER_ID}] Background sync worker process started.`);
pollAndProcess();
