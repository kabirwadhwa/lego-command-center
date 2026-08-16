import { POST } from "@/app/api/webhooks/shopify/route";
import { prisma, pool } from "@/lib/prisma";
import { MarketplaceType, EventStatus, ProductCondition, AlertType, SyncStatus } from "@prisma/client";
import crypto from "crypto";
import { SyncService } from "@/services/marketplace/syncService";

describe("Shopify Webhooks, Idempotency & Inventory Integrity integration tests", () => {
  const webhookSecret = "test-secret-key-123";
  const shopifyOrderId = "999999999";
  let companyAccountId: string;
  let personalAccountId: string;
  let testVariantId: string;
  const testSku = "LGO-88888-NEW";

  beforeAll(async () => {
    // 1. Fetch Company and Personal Accounts
    const companyAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY", status: "ACTIVE" },
    });
    const personalAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "PERSONAL", status: "ACTIVE" },
    });

    if (!companyAcc || !personalAcc) {
      throw new Error("Target inventory accounts not found in seeded database.");
    }
    companyAccountId = companyAcc.id;
    personalAccountId = personalAcc.id;

    // 2. Ensure test product and variant exists
    let product = await prisma.product.findUnique({
      where: { setNumber: "88888" },
    });
    if (!product) {
      product = await prisma.product.create({
        data: {
          setNumber: "88888",
          name: "Webhook Test Millennium Falcon",
          theme: "Star Wars",
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
          condition: ProductCondition.NEW_SEALED,
          status: "ACTIVE",
        },
      });
    }
    testVariantId = variant.id;

    // 3. Configure Shopify Marketplace credentials for HMAC tests
    await prisma.marketplace.upsert({
      where: { id: MarketplaceType.SHOPIFY },
      create: {
        id: MarketplaceType.SHOPIFY,
        name: "Shopify Store",
        status: "CONNECTED",
        mode: "REAL",
        credentialsJson: JSON.stringify({
          shopName: "test-vervliet.myshopify.com",
          accessToken: "shpat_test_token",
          webhookSecret: webhookSecret,
        }),
      },
      update: {
        status: "CONNECTED",
        mode: "REAL",
        credentialsJson: JSON.stringify({
          shopName: "test-vervliet.myshopify.com",
          accessToken: "shpat_test_token",
          webhookSecret: webhookSecret,
        }),
      },
    });
  });

  afterAll(async () => {
    // Clean up test transactions, sales, and accounts
    await prisma.saleItem.deleteMany({
      where: { sale: { marketplaceId: MarketplaceType.SHOPIFY } },
    });
    await prisma.sale.deleteMany({
      where: { marketplaceId: MarketplaceType.SHOPIFY },
    });
    await prisma.inventoryTransaction.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.inventoryBalance.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.syncJob.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.alert.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.marketplaceEvent.deleteMany({
      where: { marketplaceId: MarketplaceType.SHOPIFY },
    });

    await prisma.$disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    // Reset inventory balance and events before each run
    await prisma.saleItem.deleteMany({
      where: { sale: { marketplaceId: MarketplaceType.SHOPIFY } },
    });
    await prisma.sale.deleteMany({
      where: { marketplaceId: MarketplaceType.SHOPIFY },
    });
    await prisma.inventoryTransaction.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.inventoryBalance.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.marketplaceEvent.deleteMany({
      where: { marketplaceId: MarketplaceType.SHOPIFY },
    });
    await prisma.alert.deleteMany({
      where: { type: AlertType.UNMATCHED_ORDER },
    });

    // Set company stock to 5, personal stock to 3
    await prisma.inventoryBalance.create({
      data: {
        productVariantId: testVariantId,
        inventoryAccountId: companyAccountId,
        quantity: 5,
        averageCost: 100.0,
      },
    });
    await prisma.inventoryBalance.create({
      data: {
        productVariantId: testVariantId,
        inventoryAccountId: personalAccountId,
        quantity: 3,
        averageCost: 100.0,
      },
    });
  });

  const createRequest = (webhookId: string, payload: Record<string, unknown>, hmacVal?: string) => {
    const payloadStr = JSON.stringify(payload);
    const signature = hmacVal || crypto
      .createHmac("sha256", webhookSecret)
      .update(payloadStr, "utf8")
      .digest("base64");

    return new Request("http://localhost/api/webhooks/shopify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shopify-topic": "orders/create",
        "x-shopify-webhook-id": webhookId,
        "x-shopify-hmac-sha256": signature,
      },
      body: payloadStr,
    });
  };

  test("Reject webhooks with invalid signatures/HMAC", async () => {
    const payload = { id: shopifyOrderId, line_items: [{ sku: testSku, quantity: 1, price: "150.00" }] };
    const req = createRequest("webhook-1", payload, "invalid-signature-value");
    
    const response = await POST(req);
    expect(response.status).toBe(401);
  });

  test("Process valid webhook for a known SKU and check stock isolation", async () => {
    const payload = {
      id: "order-id-1",
      total_price: "150.00",
      total_discounts: "0.00",
      created_at: new Date().toISOString(),
      line_items: [{ sku: testSku, quantity: 1, price: "150.00" }],
    };
    
    const req = createRequest("webhook-valid-2", payload);
    const response = await POST(req);
    expect(response.status).toBe(200);

    // Verify company stock decremented by 1 (5 -> 4)
    const companyBal = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });
    expect(companyBal?.quantity).toBe(4);

    // Verify personal stock is isolated and remains unchanged (3)
    const personalBal = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: personalAccountId,
        },
      },
    });
    expect(personalBal?.quantity).toBe(3);
  });

  test("Unknown SKU order creates UNMATCHED_ORDER alert and leaves stock untouched", async () => {
    const unknownSku = "LGO-UNKNOWN-SKU-999";
    const payload = {
      id: "order-id-2",
      total_price: "200.00",
      line_items: [{ sku: unknownSku, quantity: 1, price: "200.00" }],
    };

    const req = createRequest("webhook-unknown-3", payload);
    const response = await POST(req);
    expect(response.status).toBe(200); // Route responds 200 but registers failure inside

    // Stock must be untouched
    const companyBal = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });
    expect(companyBal?.quantity).toBe(5);

    // Operational alert must be created
    const alerts = await prisma.alert.findMany({
      where: { type: AlertType.UNMATCHED_ORDER },
    });
    expect(alerts.length).toBe(1);
    expect(alerts[0].message).toContain(unknownSku);
  });

  test("Event duplication: Same webhook event twice executes exactly once", async () => {
    const payload = {
      id: "order-id-3",
      total_price: "150.00",
      line_items: [{ sku: testSku, quantity: 1, price: "150.00" }],
    };
    
    // Send event the first time
    const req1 = createRequest("duplicate-webhook-4", payload);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    // Send the exact same event a second time
    const req2 = createRequest("duplicate-webhook-4", payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    const body2 = await res2.json();
    expect(body2.duplicated).toBe(true);

    // Stock should only be decremented once (5 -> 4)
    const companyBal = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });
    expect(companyBal?.quantity).toBe(4);
  });

  test("Commercial order duplication: Different webhook events for same order ID execute exactly once", async () => {
    const payload1 = {
      id: "order-id-4",
      total_price: "150.00",
      line_items: [{ sku: testSku, quantity: 1, price: "150.00" }],
    };
    const payload2 = {
      id: "order-id-4", // Same order ID
      total_price: "150.00",
      line_items: [{ sku: testSku, quantity: 1, price: "150.00" }],
      note: "Updated note trigger", // Forces a different payload string
    };

    // Process first webhook event
    const req1 = createRequest("webhook-event-5a", payload1);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    // Process second webhook event for same order
    const req2 = createRequest("webhook-event-5b", payload2);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    // Stock should only be decremented once (5 -> 4)
    const companyBal = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });
    expect(companyBal?.quantity).toBe(4);
  });

  test("Concurrent order processing against last available unit", async () => {
    // Reduce stock to exactly 1
    await prisma.inventoryBalance.update({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
      data: { quantity: 1 },
    });

    const payload1 = {
      id: "1001",
      total_price: "100.00",
      line_items: [{ sku: testSku, quantity: 1, price: "100.00" }],
    };
    const payload2 = {
      id: "1002",
      total_price: "100.00",
      line_items: [{ sku: testSku, quantity: 1, price: "100.00" }],
    };

    // Trigger two processing calls concurrently
    const req1 = createRequest("webhook-concurrent-a", payload1);
    const req2 = createRequest("webhook-concurrent-b", payload2);

    const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);
    
    // One must succeed and the other must fail (or report failure inside the processed event log)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const data1 = await res1.json();
    const data2 = await res2.json();

    const event1 = await prisma.marketplaceEvent.findUnique({ where: { id: data1.eventId } });
    const event2 = await prisma.marketplaceEvent.findUnique({ where: { id: data2.eventId } });

    const statuses = [event1?.processingStatus, event2?.processingStatus];
    expect(statuses).toContain(EventStatus.SUCCESS);
    expect(statuses).toContain(EventStatus.FAILED);

    // Authoritative stock must be exactly 0
    const companyBal = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });
    expect(companyBal?.quantity).toBe(0);
  });

  test("Outbound sync job failure and successful retry", async () => {
    // Create sync job manually and set it to FAILED to simulate failure
    const syncJob = await prisma.syncJob.create({
      data: {
        marketplace: MarketplaceType.SHOPIFY,
        operation: "SYNC_INVENTORY",
        productVariantId: testVariantId,
        status: SyncStatus.FAILED,
        attemptNumber: 4,
        errorDetails: "Mock sync connection failure.",
      },
    });

    // Verify it exists in failed status
    expect(syncJob.status).toBe(SyncStatus.FAILED);

    // Mock adapter mode back to DEMO to allow successful retry execution
    await prisma.marketplace.update({
      where: { id: MarketplaceType.SHOPIFY },
      data: { mode: "DEMO" },
    });

    // Run retry process
    const retryRes = await SyncService.processJob(syncJob.id);
    expect(retryRes.success).toBe(true);

    const updatedJob = await prisma.syncJob.findUnique({
      where: { id: syncJob.id },
    });
    expect(updatedJob?.status).toBe(SyncStatus.SUCCESS);
  });
});
