import { SyncStatus } from "@prisma/client";
import { MarketplaceAdapter, MarketplaceOrder, MarketplaceListing, MarketplacePriceObservation, MarketplaceCapabilities } from "./types";

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

  getCapabilities(): MarketplaceCapabilities {
    if (this.mode === "DEMO") {
      return {
        orders: "AVAILABLE",
        inventorySync: "AVAILABLE",
        pricing: "AVAILABLE",
        webhooks: "AVAILABLE",
      };
    }

    const hasCreds = !!(this.credentials?.shopName && this.credentials?.accessToken);
    const hasWebhookSecret = !!this.credentials?.webhookSecret;

    return {
      orders: hasCreds ? "AVAILABLE" : "NOT_CONFIGURED",
      inventorySync: hasCreds ? "AVAILABLE" : "NOT_CONFIGURED",
      pricing: hasCreds ? "AVAILABLE" : "NOT_CONFIGURED",
      webhooks: hasCreds && hasWebhookSecret ? "AVAILABLE" : "NOT_CONFIGURED",
    };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (this.mode === "DEMO") {
      return { success: true };
    }

    if (!this.credentials?.shopName || !this.credentials?.accessToken) {
      return { success: false, error: "NOT_CONFIGURED: Shopify credentials are missing." };
    }

    const { shopName, accessToken } = this.credentials;
    const cleanShop = shopName.replace("https://", "").replace("http://", "");
    const url = `https://${cleanShop}/admin/api/2023-07/shop.json`;

    try {
      const response = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        return { success: true };
      } else {
        return { success: false, error: `Shopify responded with status: ${response.status} ${response.statusText}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error connecting to Shopify.";
      return { success: false, error: msg };
    }
  }
}
