import prisma from "@/lib/prisma";
import { MarketplaceType, ActorType, AlertType, AlertSeverity, EventStatus } from "@prisma/client";
import { InventoryService, DomainError } from "../inventoryService";

export class MarketplaceEventProcessor {
  /**
   * Processes a queued incoming marketplace webhook event.
   */
  static async processEvent(eventId: string): Promise<{ success: boolean; error?: string }> {
    const event = await prisma.marketplaceEvent.findUnique({
      where: { id: eventId },
    });

    if (!event || event.processingStatus !== EventStatus.PENDING) {
      return { success: false, error: "Event not found or already processed." };
    }

    // Update status to PROCESSING
    await prisma.marketplaceEvent.update({
      where: { id: eventId },
      data: { processingStatus: EventStatus.PROCESSING },
    });

    try {
      if (event.marketplaceId === MarketplaceType.SHOPIFY && event.eventType === "orders/create") {
        const payload = JSON.parse(event.payload || "{}");
        const externalOrderId = String(payload.id);
        const orderDate = new Date(payload.created_at || Date.now());
        
        const lineItems = payload.line_items || [];
        if (lineItems.length === 0) {
          throw new Error("No line items found in Shopify order.");
        }

        // 1. Resolve active Company account
        const companyAccount = await prisma.inventoryAccount.findFirst({
          where: { type: "COMPANY", status: "ACTIVE" },
        });

        if (!companyAccount) {
          throw new Error("No active Company inventory account found.");
        }

        // 2. Validate SKUs & construct items list
        const saleItems = [];
        for (const item of lineItems) {
          const sku = item.sku;
          
          if (!sku) {
            await this.createUnmatchedOrderAlert(
              externalOrderId,
              "MISSING_SKU",
              event.marketplaceId,
              `Line item title: ${item.title} has no SKU.`
            );
            throw new Error(`Line item has no SKU.`);
          }

          const variant = await prisma.productVariant.findUnique({
            where: { sku, status: "ACTIVE" },
            include: { product: true },
          });

          if (!variant) {
            await this.createUnmatchedOrderAlert(
              externalOrderId,
              sku,
              event.marketplaceId,
              `Unknown SKU: ${sku} in Shopify order #${externalOrderId}`
            );
            throw new Error(`Unmatched SKU: ${sku}`);
          }

          saleItems.push({
            productVariantId: variant.id,
            inventoryAccountId: companyAccount.id,
            quantity: item.quantity || 1,
            unitSalePrice: parseFloat(item.price) || 0,
          });
        }

        // Parse financial properties
        const grossRevenue = parseFloat(payload.total_price) || 0;
        const discount = parseFloat(payload.total_discounts) || 0;
        const shippingRevenue = payload.shipping_lines?.reduce(
          (sum: number, line: { price?: string | number }) => sum + (parseFloat(String(line.price || 0)) || 0),
          0
        ) || 0;
        
        // Approximate Shopify payment processing fee (approx. 3%)
        const marketplaceFees = grossRevenue * 0.03;

        // 3. Process the sale using the core transaction service
        try {
          await InventoryService.recordSale({
            actorType: ActorType.MARKETPLACE,
            actorId: `SHOPIFY-${externalOrderId}`,
            actorName: "Shopify Integration",
            marketplaceId: MarketplaceType.SHOPIFY,
            externalOrderId,
            saleDate: orderDate,
            items: saleItems,
            grossRevenue,
            marketplaceFees,
            shippingRevenue,
            discount,
            notes: `Shopify order #${payload.order_number || externalOrderId} ingested via webhook.`,
          });
        } catch (err) {
          // Commercial order-level idempotency
          if (err instanceof DomainError && err.code === "DUPLICATE_EXTERNAL_ORDER") {
            await prisma.marketplaceEvent.update({
              where: { id: eventId },
              data: {
                processingStatus: EventStatus.SUCCESS,
                processedAt: new Date(),
              },
            });
            return { success: true };
          }
          throw err;
        }

        // 4. Queue outbound sync jobs for connected marketplaces
        await this.queueOutboundSyncJobs(
          saleItems.map((item) => item.productVariantId),
          event.marketplaceId
        );
      }

      // Mark incoming event as SUCCESS
      await prisma.marketplaceEvent.update({
        where: { id: eventId },
        data: {
          processingStatus: EventStatus.SUCCESS,
          processedAt: new Date(),
        },
      });

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown event processing failure.";
      await prisma.marketplaceEvent.update({
        where: { id: eventId },
        data: {
          processingStatus: EventStatus.FAILED,
          failureReason: errorMsg,
          processedAt: new Date(),
        },
      });
      return { success: false, error: errorMsg };
    }
  }

  private static async createUnmatchedOrderAlert(
    externalOrderId: string,
    sku: string,
    marketplace: MarketplaceType,
    details: string
  ) {
    await prisma.alert.create({
      data: {
        type: AlertType.UNMATCHED_ORDER,
        severity: AlertSeverity.CRITICAL,
        message: `UNMATCHED_ORDER: Order #${externalOrderId} from ${marketplace} contains unknown SKU: ${sku}. Details: ${details}`,
      },
    });
  }

  private static async queueOutboundSyncJobs(productVariantIds: string[], sourceMarketplace: MarketplaceType) {
    // Sync مرکزی checks which other channels are active
    const activeMarketplaces = await prisma.marketplace.findMany({
      where: {
        status: "CONNECTED",
        id: { not: sourceMarketplace }, // Skip the channel that triggered this update to prevent loop feedback
      },
    });

    for (const m of activeMarketplaces) {
      for (const variantId of productVariantIds) {
        await prisma.syncJob.create({
          data: {
            marketplace: m.id,
            operation: "SYNC_INVENTORY",
            productVariantId: variantId,
            status: "PENDING",
          },
        });
      }
    }
  }
}
