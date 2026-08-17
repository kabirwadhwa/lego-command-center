/* eslint-disable @typescript-eslint/no-explicit-any */
import { ShopifyAdapter } from "@/services/marketplace/shopify";
import { prisma, pool } from "@/lib/prisma";
import { MarketplaceType } from "@prisma/client";

describe("Shopify GraphQL Parsing, Pagination, Idempotency and Reconciliation Tests", () => {
  let mockAdapter: ShopifyAdapter;
  let testVariantId: string;
  let testListingId: string;
  const testSku = "LGO-SHOPIFY-TEST";
  const externalVariantId = "gid://shopify/ProductVariant/7777777";
  const externalItemId = "gid://shopify/InventoryItem/8888888";
  const externalLocId = "gid://shopify/Location/9999999";

  beforeAll(async () => {
    // Resolve Company Account
    const companyAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY", status: "ACTIVE" },
    });
    if (!companyAcc) throw new Error("Company account not found.");

    // Create a product variant
    let product = await prisma.product.findUnique({
      where: { setNumber: "77777" },
    });
    if (!product) {
      product = await prisma.product.create({
        data: {
          setNumber: "77777",
          name: "Shopify Concurrency Test Set",
          theme: "Icons",
          status: "ACTIVE",
        },
      });
    }

    let variant = await prisma.productVariant.findUnique({
      where: { sku: testSku },
    });
    if (!variant) {
      variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: testSku,
          condition: "NEW_SEALED",
          status: "ACTIVE",
        },
      });
    }
    testVariantId = variant.id;

    // Create a listing record representing last known remote state
    let listing = await prisma.marketplaceListing.findUnique({
      where: {
        marketplace_externalListingId: {
          marketplace: MarketplaceType.SHOPIFY,
          externalListingId: externalVariantId,
        },
      },
    });
    if (!listing) {
      listing = await prisma.marketplaceListing.create({
        data: {
          productVariantId: testVariantId,
          marketplace: MarketplaceType.SHOPIFY,
          externalListingId: externalVariantId,
          shopifyInventoryItemId: externalItemId,
          shopifyLocationId: externalLocId,
          price: 199.99,
          quantity: 10, // last known remote quantity was 10
          status: "ACTIVE",
        },
      });
    }
    testListingId = listing.id;

    // Instantiate adapter in REAL mode with dummy credentials
    mockAdapter = new ShopifyAdapter("REAL", JSON.stringify({
      shopName: "my-test-store.myshopify.com",
      accessToken: "shpat_mock_token_12345",
    }));
  });

  afterAll(async () => {
    await prisma.marketplaceListing.deleteMany({
      where: { id: testListingId },
    });
    await prisma.productVariant.deleteMany({
      where: { id: testVariantId },
    });
    await prisma.product.deleteMany({
      where: { setNumber: "77777" },
    });
    await prisma.$disconnect();
    await pool.end();
  });

  test("syncInventory rejects push if actual remote quantity differs from last known quantity (reconciliation discrepancy)", async () => {
    // Mock the GraphQL execution responses
    const executeMock = jest.spyOn(mockAdapter as any, "executeGraphQL");
    
    // First call inside syncInventory: fetch inventory levels
    executeMock.mockResolvedValueOnce({
      inventoryItem: {
        inventoryLevels: {
          edges: [
            {
              node: {
                location: { id: externalLocId },
                quantities: [{ name: "available", quantity: 15 }], // Remote has 15 (differs from expected 10!)
              },
            },
          ],
        },
      },
    });

    const result = await mockAdapter.syncInventory(testSku, 20, "job-123");

    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("RECONCILIATION_DISCREPANCY");
    expect(result.error).toContain("differs from last known local listing quantity");

    // Verify it didn't write to Shopify
    expect(executeMock).toHaveBeenCalledTimes(1);

    executeMock.mockRestore();
  });

  test("syncInventory pushes compare-and-swap mutation when quantities match", async () => {
    const executeMock = jest.spyOn(mockAdapter as any, "executeGraphQL");

    // Update listing to be in sync
    await prisma.marketplaceListing.update({
      where: { id: testListingId },
      data: { quantity: 10 },
    });

    // 1. Fetch inventory levels returns 10 (matches database!)
    executeMock.mockResolvedValueOnce({
      inventoryItem: {
        inventoryLevels: {
          edges: [
            {
              node: {
                location: { id: externalLocId },
                quantities: [{ name: "available", quantity: 10 }],
              },
            },
          ],
        },
      },
    });

    // 2. Set inventory mutation returns success
    executeMock.mockResolvedValueOnce({
      inventorySetQuantities: {
        inventoryAdjustmentGroup: { id: "gid://shopify/InventoryAdjustmentGroup/1" },
        userErrors: [],
      },
    });

    const result = await mockAdapter.syncInventory(testSku, 12, "job-456");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SUCCESS");

    // Verify correct mutation parameters were sent
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock).toHaveBeenNthCalledWith(2, expect.stringContaining("mutation inventorySet"), {
      idempotencyKey: "shopify-sync-job-456",
      input: {
        name: "available",
        reason: "correction",
        quantities: [
          {
            inventoryItemId: externalItemId,
            locationId: externalLocId,
            quantity: 12,
            changeFromQuantity: 10,
          },
        ],
      },
    });

    // Verify database was updated to new synced quantity
    const updatedListing = await prisma.marketplaceListing.findUnique({
      where: { id: testListingId },
    });
    expect(updatedListing?.quantity).toBe(12);

    executeMock.mockRestore();
  });
});
