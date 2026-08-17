/* eslint-disable @typescript-eslint/no-explicit-any */
import { 
  MarketplaceAdapter, 
  MarketplaceOrder, 
  MarketplaceListing, 
  MarketplacePriceObservation, 
  MarketplaceCapabilities 
} from "./types";
import { MarketplaceType, SyncStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export class ShopifyAdapter implements MarketplaceAdapter {
  private mode: "REAL" | "DEMO";
  private credentials?: {
    shopName?: string;
    accessToken?: string;
    webhookSecret?: string;
  } | null;

  constructor(mode: "REAL" | "DEMO" = "DEMO", credentialsJson?: string | null) {
    this.mode = mode;
    if (credentialsJson) {
      try {
        this.credentials = JSON.parse(credentialsJson);
      } catch (e) {
        console.error("Failed to parse Shopify credentials:", e);
      }
    }
  }

  private async executeGraphQL(query: string, variables: any = {}): Promise<any> {
    if (!this.credentials?.shopName || !this.credentials?.accessToken) {
      throw new Error("NOT_CONFIGURED: Shopify credentials are missing.");
    }

    const { shopName, accessToken } = this.credentials;
    const cleanShop = shopName.replace("https://", "").replace("http://", "");
    const url = `https://${cleanShop}/admin/api/2026-07/graphql.json`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Shopify GraphQL responded with status ${response.status}: ${response.statusText}`);
    }

    const resJson = await response.json();
    if (resJson.errors) {
      const messages = resJson.errors.map((e: any) => e.message).join(", ");
      throw new Error(`Shopify GraphQL Error: messages=[${messages}]`);
    }

    return resJson.data;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (this.mode === "DEMO") {
      return { success: true };
    }

    if (!this.credentials?.shopName || !this.credentials?.accessToken) {
      return { success: false, error: "NOT_CONFIGURED: Shopify credentials are missing." };
    }

    try {
      const query = `
        query {
          shop {
            name
            myshopifyDomain
          }
        }
      `;
      const data = await this.executeGraphQL(query);
      if (data && data.shop) {
        return { success: true };
      }
      return { success: false, error: "Failed to parse shop domain from GraphQL response." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection failed.";
      return { success: false, error: msg };
    }
  }

  async getListings(): Promise<MarketplaceListing[]> {
    if (this.mode === "DEMO") {
      return [
        {
          sku: "LGO-10330-NEW_SEALED",
          externalListingId: "shopify-10330",
          title: "LEGO Icons Concorde (10330)",
          price: new Prisma.Decimal(169.99),
          quantity: 5,
          status: "ACTIVE",
          shopifyInventoryItemId: "item-10330",
          shopifyLocationId: "loc-1",
        } as any
      ];
    }

    try {
      // 1. Fetch active locations
      const locQuery = `
        query {
          locations(first: 50) {
            edges {
              node {
                id
                isActive
              }
            }
          }
        }
      `;
      const locData = await this.executeGraphQL(locQuery);
      const activeLoc = locData.locations.edges.find((e: any) => e.node.isActive);
      const locationId = activeLoc ? activeLoc.node.id : null;

      if (!locationId) {
        throw new Error("No active Shopify locations found.");
      }

      // 2. Fetch products and variants
      const listings: MarketplaceListing[] = [];
      let hasNextPage = true;
      let cursor: string | null = null;

      const productQuery = `
        query getProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                      inventoryItem {
                        id
                        tracked
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      while (hasNextPage) {
        const prodData = await this.executeGraphQL(productQuery, { cursor });
        const productsConnection = prodData.products;
        hasNextPage = productsConnection.pageInfo.hasNextPage;
        cursor = productsConnection.pageInfo.endCursor;

        for (const prodEdge of productsConnection.edges) {
          for (const varEdge of prodEdge.node.variants.edges) {
            const varNode = varEdge.node;
            if (!varNode.sku) continue;

            const inventoryItemId = varNode.inventoryItem ? varNode.inventoryItem.id : null;
            let quantity = 0;

            if (inventoryItemId) {
              const invQuery = `
                query getInventory($itemId: ID!) {
                  inventoryItem(id: $itemId) {
                    inventoryLevels(first: 50) {
                      edges {
                        node {
                          location {
                            id
                          }
                          quantities(names: ["available"]) {
                            quantity
                          }
                        }
                      }
                    }
                  }
                }
              `;
              try {
                const invData = await this.executeGraphQL(invQuery, { itemId: inventoryItemId });
                const levels = invData.inventoryItem?.inventoryLevels?.edges || [];
                const locationLevel = levels.find((l: any) => l.node.location.id === locationId);
                if (locationLevel) {
                  const qtyObj = locationLevel.node.quantities.find((q: any) => q.name === "available");
                  quantity = qtyObj ? qtyObj.quantity : 0;
                }
              } catch (e) {
                console.error(`Failed to fetch inventory levels for item ${inventoryItemId}:`, e);
              }
            }

            listings.push({
              id: "",
              productVariantId: "",
              marketplace: MarketplaceType.SHOPIFY,
              externalListingId: varNode.id,
              listingUrl: null,
              status: "ACTIVE",
              price: new Prisma.Decimal(varNode.price),
              quantity,
              shopifyInventoryItemId: inventoryItemId,
              shopifyLocationId: locationId,
              lastSyncedAt: new Date()
            } as any);
          }
        }
      }

      return listings;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to retrieve products.";
      throw new Error(msg);
    }
  }

  async getListing(externalListingId: string): Promise<MarketplaceListing | null> {
    if (this.mode === "DEMO") {
      return {
        sku: "LGO-10330-NEW_SEALED",
        externalListingId,
        title: "LEGO Icons Concorde (10330)",
        price: new Prisma.Decimal(169.99),
        quantity: 5,
        status: "ACTIVE",
        shopifyInventoryItemId: "item-10330",
        shopifyLocationId: "loc-1",
        lastSyncedAt: new Date()
      } as any;
    }

    try {
      const query = `
        query getVariant($id: ID!) {
          productVariant(id: $id) {
            id
            sku
            price
            inventoryItem {
              id
              inventoryLevels(first: 50) {
                edges {
                  node {
                    location {
                      id
                    }
                    quantities(names: ["available"]) {
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      `;
      const data = await this.executeGraphQL(query, { id: externalListingId });
      const variantNode = data.productVariant;
      if (!variantNode) return null;

      const inventoryItemId = variantNode.inventoryItem ? variantNode.inventoryItem.id : null;
      let quantity = 0;
      let locationId: string | null = null;

      if (inventoryItemId) {
        const levels = variantNode.inventoryItem.inventoryLevels.edges;
        if (levels.length > 0) {
          const firstLevel = levels[0];
          locationId = firstLevel.node.location.id;
          const qtyObj = firstLevel.node.quantities.find((q: any) => q.name === "available");
          quantity = qtyObj ? qtyObj.quantity : 0;
        }
      }

      return {
        sku: variantNode.sku || "",
        externalListingId: variantNode.id,
        price: new Prisma.Decimal(variantNode.price),
        quantity,
        status: "ACTIVE",
        shopifyInventoryItemId: inventoryItemId,
        shopifyLocationId: locationId,
        lastSyncedAt: new Date()
      } as any;
    } catch (e) {
      console.error(`Failed to fetch Shopify variant ${externalListingId}:`, e);
      return null;
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
          marketplaceFees: null,
          shippingRevenue: 0.0,
          discount: 0.0,
          netRevenue: null,
        }
      ];
    }

    try {
      const query = `
        query getOrders {
          orders(first: 50) {
            edges {
              node {
                id
                name
                createdAt
                email
                customer {
                  firstName
                  lastName
                }
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      sku
                      quantity
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;
      const data = await this.executeGraphQL(query);
      const orders: MarketplaceOrder[] = [];

      for (const edge of data.orders.edges) {
        const node = edge.node;
        const items = node.lineItems.edges
          .filter((e: any) => e.node.sku)
          .map((e: any) => ({
            sku: e.node.sku,
            quantity: e.node.quantity,
            unitSalePrice: parseFloat(e.node.originalUnitPriceSet.shopMoney.amount),
          }));

        if (items.length === 0) continue;

        orders.push({
          externalOrderId: node.id,
          customerName: node.customer ? `${node.customer.firstName} ${node.customer.lastName}`.trim() : "Unknown Customer",
          email: node.email || "",
          orderDate: new Date(node.createdAt),
          items,
          grossRevenue: parseFloat(node.totalPriceSet.shopMoney.amount),
          marketplaceFees: null,
          shippingRevenue: 0.0,
          discount: 0.0,
          netRevenue: null,
        });
      }

      return orders;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to retrieve orders.";
      throw new Error(msg);
    }
  }

  async getOrder(externalOrderId: string): Promise<MarketplaceOrder | null> {
    const orders = await this.getOrders();
    return orders.find((o) => o.externalOrderId === externalOrderId) || null;
  }

  async syncInventory(sku: string, quantity: number, jobId?: string): Promise<{ success: boolean; status: SyncStatus; error?: string }> {
    if (this.mode === "DEMO") {
      console.log(`[DEMO Shopify] Synced SKU ${sku} quantity to ${quantity}`);
      return { success: true, status: "SUCCESS" };
    }

    if (!this.credentials?.shopName || !this.credentials?.accessToken) {
      return { success: false, status: "FAILED", error: "NOT_CONFIGURED" };
    }

    try {
      // 1. Resolve listing records and Shopify keys from database
      const listing = await prisma.marketplaceListing.findFirst({
        where: { marketplace: MarketplaceType.SHOPIFY, productVariant: { sku } },
      });

      let shopifyInventoryItemId = listing?.shopifyInventoryItemId;
      let shopifyLocationId = listing?.shopifyLocationId;

      // 2. Fallback to querying variant dynamically if missing in database
      if (!shopifyInventoryItemId || !shopifyLocationId) {
        if (!listing?.externalListingId) {
          throw new Error(`No listing or externalListingId found for SKU: ${sku}`);
        }
        const remoteListing = await this.getListing(listing.externalListingId);
        if (!remoteListing?.shopifyInventoryItemId || !remoteListing?.shopifyLocationId) {
          throw new Error(`Could not resolve Shopify inventory item or location IDs for SKU: ${sku}`);
        }
        shopifyInventoryItemId = remoteListing.shopifyInventoryItemId;
        shopifyLocationId = remoteListing.shopifyLocationId;

        // Persist the resolved IDs to database
        await prisma.marketplaceListing.update({
          where: { id: listing.id },
          data: {
            shopifyInventoryItemId,
            shopifyLocationId,
          },
        });
      }

      // 3. Fetch actual current remote quantity on Shopify to verify compare-and-swap
      let currentRemoteQty = 0;
      const invQuery = `
        query getInventory($itemId: ID!) {
          inventoryItem(id: $itemId) {
            inventoryLevels(first: 50) {
              edges {
                node {
                  location {
                    id
                  }
                  quantities(names: ["available"]) {
                    quantity
                  }
                }
              }
            }
          }
        }
      `;
      const invData = await this.executeGraphQL(invQuery, { itemId: shopifyInventoryItemId });
      const levels = invData.inventoryItem?.inventoryLevels?.edges || [];
      const locationLevel = levels.find((l: any) => l.node.location.id === shopifyLocationId);
      if (locationLevel) {
        const qtyObj = locationLevel.node.quantities.find((q: any) => q.name === "available");
        currentRemoteQty = qtyObj ? qtyObj.quantity : 0;
      }

      // 4. Concurrency Protection Check: Verify against our last synced local value
      if (listing && listing.quantity !== currentRemoteQty) {
        // Unexpected remote modification has occurred! Raise discrepancy error
        return {
          success: false,
          status: "FAILED",
          error: `RECONCILIATION_DISCREPANCY: Remote quantity on Shopify (${currentRemoteQty}) differs from last known local listing quantity (${listing.quantity}). Overwrite aborted.`,
        };
      }

      // 5. Build deterministic idempotency key per SyncJob
      const idempotencyKey = jobId ? `shopify-sync-${jobId}` : `shopify-sync-${crypto.randomUUID()}`;

      // 6. Push the absolute quantity update using compare-and-swap semantics
      const mutation = `
        mutation inventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) @idempotent(key: $idempotencyKey) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        idempotencyKey,
        input: {
          name: "available",
          reason: "correction",
          quantities: [
            {
              inventoryItemId: shopifyInventoryItemId,
              locationId: shopifyLocationId,
              quantity: quantity,
              changeFromQuantity: currentRemoteQty,
            },
          ],
        },
      };

      const mutationData = await this.executeGraphQL(mutation, variables);
      const errors = mutationData.inventorySetQuantities.userErrors;

      if (errors && errors.length > 0) {
        const errMsgs = errors.map((e: any) => e.message).join(", ");
        throw new Error(`Shopify compare-and-swap rejected update: ${errMsgs}`);
      }

      // 7. Update last synced quantity locally
      if (listing) {
        await prisma.marketplaceListing.update({
          where: { id: listing.id },
          data: {
            quantity: quantity,
            lastSyncedAt: new Date(),
          },
        });
      }

      return { success: true, status: "SUCCESS" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync execution failed.";
      return { success: false, status: "FAILED", error: msg };
    }
  }

  async updatePrice(externalListingId: string, price: number): Promise<{ success: boolean; error?: string }> {
    if (this.mode === "DEMO") {
      console.log(`[DEMO Shopify] Updated listing ${externalListingId} price to ${price}`);
      return { success: true };
    }

    try {
      const query = `
        mutation updateVariantPrice($input: ProductVariantInput!) {
          productVariantUpdate(input: $input) {
            productVariant {
              id
              price
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      const variables = {
        input: {
          id: externalListingId,
          price: price.toFixed(2),
        },
      };

      const data = await this.executeGraphQL(query, variables);
      const errors = data.productVariantUpdate.userErrors;
      if (errors && errors.length > 0) {
        throw new Error(errors.map((e: any) => e.message).join(", "));
      }

      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update Shopify price.";
      return { success: false, error: msg };
    }
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
}
