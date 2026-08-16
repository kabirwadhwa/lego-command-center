import { SyncStatus } from "@prisma/client";
import { MarketplaceAdapter, MarketplaceOrder, MarketplaceListing, MarketplacePriceObservation } from "./types";

export class BolAdapter implements MarketplaceAdapter {
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
          externalOrderId: "BOL-MOCK-3001",
          customerName: "Jane Smith",
          email: "jane@example.com",
          orderDate: new Date(),
          items: [{ sku: "LGO-10330-NEW_SEALED", quantity: 1, unitSalePrice: 115.0 }],
          grossRevenue: 115.0,
          marketplaceFees: 15.0,
          shippingRevenue: 0.0,
          discount: 0.0,
          netRevenue: 100.0,
        }
      ];
    }

    if (!this.credentials?.clientId || !this.credentials?.clientSecret) {
      throw new Error("NOT_CONFIGURED: Bol credentials are missing.");
    }

    throw new Error("NOT_SUPPORTED");
  }

  async getOrder(externalOrderId: string): Promise<MarketplaceOrder | null> {
    const orders = await this.getOrders();
    return orders.find((o) => o.externalOrderId === externalOrderId) || null;
  }

  async syncInventory(sku: string, quantity: number): Promise<{ success: boolean; status: SyncStatus; error?: string }> {
    if (this.mode === "DEMO") {
      console.log(`[DEMO Bol] Synced SKU ${sku} quantity to ${quantity}`);
      return { success: true, status: "SUCCESS" };
    }

    if (!this.credentials?.clientId || !this.credentials?.clientSecret) {
      return { success: false, status: "FAILED", error: "NOT_CONFIGURED" };
    }

    throw new Error("NOT_SUPPORTED");
  }

  async getListing(externalListingId: string): Promise<MarketplaceListing | null> {
    if (this.mode === "DEMO") {
      return {
        sku: "LGO-10330-NEW_SEALED",
        externalListingId,
        title: "LEGO Icons Concorde (10330)",
        price: 179.99,
        quantity: 3,
        status: "ACTIVE"
      };
    }
    throw new Error("NOT_SUPPORTED");
  }

  async getListings(): Promise<MarketplaceListing[]> {
    if (this.mode === "DEMO") {
      return [
        {
          sku: "LGO-10330-NEW_SEALED",
          externalListingId: "bol-10330",
          title: "LEGO Icons Concorde (10330)",
          price: 179.99,
          quantity: 3,
          status: "ACTIVE"
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
          price: 182.50,
          currency: "EUR",
          priceType: "ASKING_PRICE",
          condition: "NEW_SEALED",
          timestamp: new Date(),
          seller: "Bol Plaza Store B",
        }
      ];
    }
    throw new Error("NOT_SUPPORTED");
  }

  supportsOrders(): boolean { return true; }
  supportsInventorySync(): boolean { return true; }
  supportsPricing(): boolean { return true; }
  supportsWebhooks(): boolean { return true; }
}
