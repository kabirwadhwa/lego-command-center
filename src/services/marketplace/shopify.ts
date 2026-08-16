import { SyncStatus } from "@prisma/client";
import { MarketplaceAdapter, MarketplaceOrder, MarketplaceListing, MarketplacePriceObservation } from "./types";

export class ShopifyAdapter implements MarketplaceAdapter {
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
          externalOrderId: "SHOPIFY-MOCK-2001",
          customerName: "John Doe",
          email: "john@example.com",
          orderDate: new Date(),
          items: [{ sku: "LGO-10330-NEW_SEALED", quantity: 1, unitSalePrice: 109.99 }],
          grossRevenue: 109.99,
          marketplaceFees: 3.30,
          shippingRevenue: 0.0,
          discount: 0.0,
          netRevenue: 106.69,
        }
      ];
    }

    if (!this.credentials?.apiKey) {
      throw new Error("NOT_CONFIGURED: Shopify credentials are missing.");
    }
    
    throw new Error("NOT_SUPPORTED: Real Shopify API calls not yet implemented.");
  }

  async getOrder(externalOrderId: string): Promise<MarketplaceOrder | null> {
    const orders = await this.getOrders();
    return orders.find((o) => o.externalOrderId === externalOrderId) || null;
  }

  async syncInventory(sku: string, quantity: number): Promise<{ success: boolean; status: SyncStatus; error?: string }> {
    if (this.mode === "DEMO") {
      console.log(`[DEMO Shopify] Synced SKU ${sku} quantity to ${quantity}`);
      return { success: true, status: "SUCCESS" };
    }

    if (!this.credentials?.apiKey) {
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
        price: 169.99,
        quantity: 5,
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
          externalListingId: "shopify-10330",
          title: "LEGO Icons Concorde (10330)",
          price: 169.99,
          quantity: 5,
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
          price: 174.99,
          currency: "EUR",
          priceType: "ASKING_PRICE",
          condition: "NEW_SEALED",
          timestamp: new Date(),
          seller: "Shopify Store A",
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
