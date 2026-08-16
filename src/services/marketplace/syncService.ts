import prisma from "@/lib/prisma";
import { SyncStatus, AlertType, AlertSeverity } from "@prisma/client";
import { MarketplaceFactory } from "./factory";

export class SyncService {
  /**
   * Queues an outbound inventory sync job for all connected channels supporting sync.
   * Runs the sync asynchronously in the background.
   */
  static async queueAndTriggerSync(productVariantId: string) {
    try {
      const activeChannels = await prisma.marketplace.findMany({
        where: {
          status: "CONNECTED",
        },
      });

      for (const channel of activeChannels) {
        const adapter = await MarketplaceFactory.getAdapter(channel.id);
        const capabilities = adapter.getCapabilities();

        if (capabilities.inventorySync === "AVAILABLE") {
          const existingPending = await prisma.syncJob.findFirst({
            where: {
              marketplace: channel.id,
              productVariantId,
              status: SyncStatus.PENDING,
            },
          });

          if (!existingPending) {
            const job = await prisma.syncJob.create({
              data: {
                marketplace: channel.id,
                operation: "SYNC_INVENTORY",
                productVariantId,
                status: SyncStatus.PENDING,
              },
            });

            // Trigger background job non-blockingly
            setTimeout(() => {
              SyncService.processJob(job.id).catch((err) => {
                console.error(`Background sync processing failed for job ${job.id}:`, err);
              });
            }, 0);
          }
        }
      }
    } catch (err) {
      console.error("Failed to queue sync jobs:", err);
    }
  }

  /**
   * Processes a single outbound sync job.
   */
  static async processJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    const job = await prisma.syncJob.findUnique({
      where: { id: jobId },
    });

    if (!job || job.status === SyncStatus.SUCCESS) {
      return { success: false, error: "Job not found or already completed." };
    }

    // Set status to PROCESSING
    const currentJob = await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: SyncStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    try {
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

      // 2. Aggregate authoritative central Company stock balance
      const companyBalances = await prisma.inventoryBalance.findMany({
        where: {
          productVariantId: job.productVariantId,
          inventoryAccount: { type: "COMPANY" },
        },
      });

      const totalCompanyQuantity = companyBalances.reduce((sum, b) => sum + b.quantity, 0);

      // 3. Invoke Marketplace Adapter
      const adapter = await MarketplaceFactory.getAdapter(job.marketplace);
      const result = await adapter.syncInventory(variant.sku, totalCompanyQuantity);

      if (result.success) {
        await prisma.syncJob.update({
          where: { id: jobId },
          data: {
            status: SyncStatus.SUCCESS,
            completedAt: new Date(),
          },
        });
        return { success: true };
      } else {
        throw new Error(result.error || "Adapter reported sync failure.");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Sync execution failed.";
      const newAttempt = currentJob.attemptNumber + 1;

      if (newAttempt <= 3) {
        // Scheduled retry
        await prisma.syncJob.update({
          where: { id: jobId },
          data: {
            status: SyncStatus.PENDING,
            attemptNumber: newAttempt,
            errorDetails: errorMsg,
          },
        });
        return { success: false, error: `Attempt ${currentJob.attemptNumber} failed. Scheduled retry. Error: ${errorMsg}` };
      } else {
        // Mark as failed permanently and trigger Alert
        await prisma.syncJob.update({
          where: { id: jobId },
          data: {
            status: SyncStatus.FAILED,
            completedAt: new Date(),
            errorDetails: errorMsg,
          },
        });

        await prisma.alert.create({
          data: {
            type: AlertType.SYNC_ERROR,
            severity: AlertSeverity.WARNING,
            message: `SYNC_ERROR | Job: ${jobId} | Marketplace: ${job.marketplace} | Variant: ${job.productVariantId} | Error: Outbound inventory sync failed after 3 attempts. Details: ${errorMsg}`,
          },
        });

        return { success: false, error: `Failed after 3 attempts. Error: ${errorMsg}` };
      }
    }
  }
}
