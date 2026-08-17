import { SyncStatus } from "@prisma/client";
import { MarketplaceAdapter, MarketplaceOrder, MarketplaceListing, MarketplacePriceObservation, MarketplaceCapabilities } from "./types";

export class CatawikiAdapter implements MarketplaceAdapter {
  private mode: "REAL" | "DEMO";
  private credentials: Record<string, string> | null = null;

  constructor(mode: "REAL" | "DEMO" = "DEMO", credentialsJson?: string | null) {
    this.mode = mode;
    if (credentialsJson) {
      try {
        this.credentials = JSON.parse(credentialsJson);
      } catch {
        this.credentials = null;
      }
    }
  }

  async getOrders(): Promise<MarketplaceOrder[]> {
    if (this.mode === "DEMO") {
      return [
        {
          externalOrderId: "CATAWIKI-MOCK-4001",
          customerName: "Auction Winner",
          email: "winner@example.com",
          orderDate: new Date(),
          items: [{ sku: "LGO-10330-NEW_SEALED", quantity: 1, unitSalePrice: 195.0 }],
          grossRevenue: 195.0,
          marketplaceFees: 17.55, // 9% seller commission typical for Catawiki
          shippingRevenue: 15.0,
          discount: 0.0,
          netRevenue: 192.45, // 195 - 17.55 + 15
        }
      ];
    }

    // Real Mode - Catawiki doesn't expose standard orders API to general users
    throw new Error("NOT_SUPPORTED: Real Catawiki orders API is not available.");
  }

  async getOrder(externalOrderId: string): Promise<MarketplaceOrder | null> {
    const orders = await this.getOrders();
    return orders.find((o) => o.externalOrderId === externalOrderId) || null;
  }

  async syncInventory(sku: string, quantity: number, _jobId?: string): Promise<{ success: boolean; status: SyncStatus; error?: string }> {
    if (this.mode === "DEMO") {
      console.log(`[DEMO Catawiki] Synced SKU ${sku} quantity to ${quantity}`);
      return { success: true, status: "SUCCESS" };
    }

    // Real Mode - Catawiki auctions don't support automated multi-item inventory sync
    return { success: false, status: "FAILED", error: "NOT_SUPPORTED" };
  }

  async getListing(externalListingId: string): Promise<MarketplaceListing | null> {
    if (this.mode === "DEMO") {
      return {
        sku: "LGO-10330-NEW_SEALED",
        externalListingId,
        title: "LEGO Icons Concorde 10330 - Collector Lot",
        price: 195.0,
        quantity: 1,
        status: "ACTIVE",
        catawikiCurrentBid: 160.0,
        catawikiReserve: 180.0,
        catawikiBuyNow: 220.0,
        catawikiAuctionEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      };
    }

    throw new Error("NOT_SUPPORTED");
  }

  async getListings(): Promise<MarketplaceListing[]> {
    if (this.mode === "DEMO") {
      return [
        {
          sku: "LGO-10330-NEW_SEALED",
          externalListingId: "catawiki-lot-99",
          title: "LEGO Icons Concorde 10330 - Collector Lot",
          price: 195.0,
          quantity: 1,
          status: "ACTIVE",
          catawikiCurrentBid: 160.0,
          catawikiReserve: 180.0,
          catawikiBuyNow: 220.0,
          catawikiAuctionEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
        }
      ];
    }
    throw new Error("NOT_SUPPORTED");
  }

  async getMarketPrices(sku: string): Promise<MarketplacePriceObservation[]> {
    if (this.mode === "DEMO") {
      return [
        {
          sku,
          price: 165.0,
          currency: "EUR",
          priceType: "CURRENT_BID",
          condition: "NEW_SEALED",
          timestamp: new Date(),
          seller: "Catawiki Bidder A",
        },
        {
          sku,
          price: 195.0,
          currency: "EUR",
          priceType: "SOLD_PRICE",
          condition: "NEW_SEALED",
          timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          seller: "Catawiki Auction Close",
        }
      ];
    }
    throw new Error("NOT_SUPPORTED");
  }

  getCapabilities(): MarketplaceCapabilities {
    if (this.mode === "DEMO") {
      return {
        orders: "AVAILABLE",
        inventorySync: "NOT_SUPPORTED",
        pricing: "AVAILABLE",
        webhooks: "NOT_SUPPORTED",
      };
    }

    return {
      orders: "NOT_SUPPORTED",
      inventorySync: "NOT_SUPPORTED",
      pricing: "NOT_SUPPORTED",
      webhooks: "NOT_SUPPORTED",
    };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (this.mode === "DEMO") {
      return { success: true };
    }
    return { success: false, error: "NOT_SUPPORTED: Real integration is not supported on Catawiki." };
  }
}
