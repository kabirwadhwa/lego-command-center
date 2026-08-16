import { prisma, pool } from "@/lib/prisma";
import { InventoryService } from "@/services/inventoryService";
import { ActorType, InventoryTransactionType, ProductCondition } from "@prisma/client";

describe("Inventory Ledger Integrity & Concurrency Invariant Tests", () => {
  let testVariantId: string;
  let companyAccountId: string;
  let personalAccountId: string;

  beforeAll(async () => {
    // 1. Fetch or seed a test product variant and accounts
    let product = await prisma.product.findUnique({
      where: { setNumber: "99999" },
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          setNumber: "99999",
          name: "Test automated set",
          theme: "Testing Theme",
          status: "ACTIVE",
        },
      });
    }

    const testSku = "LGO-99999-NEW-TEST";
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

    // Fetch accounts
    const companyAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY" },
    });
    const personalAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "PERSONAL" },
    });

    if (!companyAcc || !personalAcc) {
      throw new Error("Seed accounts are required for running tests.");
    }
    companyAccountId = companyAcc.id;
    personalAccountId = personalAcc.id;
  });

  async function cleanTestRecords() {
    // Find associated purchase items and sales items to clean parent records
    const testPurchaseItems = await prisma.purchaseItem.findMany({
      where: { productVariantId: testVariantId }
    });
    const purchaseIds = testPurchaseItems.map(pi => pi.purchaseId);
    
    const testSaleItems = await prisma.saleItem.findMany({
      where: { productVariantId: testVariantId }
    });
    const saleIds = testSaleItems.map(si => si.saleId);

    // Delete child items
    await prisma.purchaseItem.deleteMany({
      where: { productVariantId: testVariantId }
    });
    await prisma.saleItem.deleteMany({
      where: { productVariantId: testVariantId }
    });

    // Delete parent records
    await prisma.purchase.deleteMany({
      where: { id: { in: purchaseIds } }
    });
    await prisma.sale.deleteMany({
      where: { id: { in: saleIds } }
    });

    // Clear ledger entries
    await prisma.inventoryTransaction.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.inventoryBalance.deleteMany({
      where: { productVariantId: testVariantId },
    });
  }

  beforeEach(async () => {
    await cleanTestRecords();
  });

  afterAll(async () => {
    await cleanTestRecords();
    
    // Clean up variant and product catalog details
    await prisma.productVariant.deleteMany({
      where: { id: testVariantId },
    });
    await prisma.product.deleteMany({
      where: { setNumber: "99999" },
    });

    // Close database pools to prevent hanging handles
    await prisma.$disconnect();
    await pool.end();
  });

  test("Ledger Consistency Invariant: Balance equals sum of transaction ledger history", async () => {
    // Perform a series of ledger adjustments: intake, transfer, sale, manual correction
    
    // 1. Intake purchase of 10 units @ 50.00 each
    await InventoryService.recordPurchase({
      actorId: "44444444-4444-4444-4444-444444444444",
      actorName: "Test Suite",
      supplier: "Test Supplier",
      purchaseDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 10,
          unitCost: 50.0,
        },
      ],
    });

    // 2. Transfer 3 units from Company to Personal
    await InventoryService.transferStock({
      actorId: "44444444-4444-4444-4444-444444444444",
      actorName: "Test Suite",
      productVariantId: testVariantId,
      sourceAccountId: companyAccountId,
      destinationAccountId: personalAccountId,
      quantity: 3,
    });

    // 3. Record a manual sale of 2 units from Company @ 85.00 each
    await InventoryService.recordSale({
      actorType: ActorType.USER,
      actorId: "44444444-4444-4444-4444-444444444444",
      actorName: "Test Suite",
      saleDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 2,
          unitSalePrice: 85.0,
        },
      ],
      grossRevenue: 170.0,
    });

    // 4. Adjust stock on Personal account (subtract 1 unit due to damage)
    await InventoryService.adjustStock({
      actorId: "44444444-4444-4444-4444-444444444444",
      actorName: "Test Suite",
      productVariantId: testVariantId,
      inventoryAccountId: personalAccountId,
      type: InventoryTransactionType.DAMAGED,
      quantityChange: -1,
    });

    // 5. Query and Assert balances align with transaction history sums
    const companyBalance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    const personalBalance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: personalAccountId,
        },
      },
    });

    const companyTxSum = await prisma.inventoryTransaction.aggregate({
      where: {
        productVariantId: testVariantId,
        inventoryAccountId: companyAccountId,
      },
      _sum: { quantity: true },
    });

    const personalTxSum = await prisma.inventoryTransaction.aggregate({
      where: {
        productVariantId: testVariantId,
        inventoryAccountId: personalAccountId,
      },
      _sum: { quantity: true },
    });

    // Assertions
    expect(companyBalance?.quantity).toBe(5); // 10 (intake) - 3 (transfer) - 2 (sale) = 5
    expect(companyTxSum._sum.quantity).toBe(5);

    expect(personalBalance?.quantity).toBe(2); // +3 (transfer) - 1 (adjust) = 2
    expect(personalTxSum._sum.quantity).toBe(2);
  });

  test("Double-Idempotency Invariant: Prevent duplicate commercial orders processing", async () => {
    // First, add stock to prevent out of stock error on sale
    await InventoryService.recordPurchase({
      actorId: "44444444-4444-4444-4444-444444444444",
      actorName: "Test Suite",
      supplier: "Test Supplier",
      purchaseDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 10,
          unitCost: 50.0,
        },
      ],
    });

    const mockOrderParams = {
      actorType: ActorType.SYSTEM,
      actorId: "system-sync",
      actorName: "Shopify Webhook",
      marketplaceId: "SHOPIFY" as const,
      externalOrderId: "SHOPIFY-TEST-1001",
      saleDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 1,
          unitSalePrice: 100.0,
        },
      ],
      grossRevenue: 100.0,
    };

    // 1. First execution should succeed
    const sale1 = await InventoryService.recordSale(mockOrderParams);
    expect(sale1.id).toBeDefined();

    // 2. Second execution with the same externalOrderId must fail
    await expect(InventoryService.recordSale(mockOrderParams)).rejects.toThrow(
      "Order reference 'SHOPIFY-TEST-1001' has already been processed"
    );
  });

  test("Concurrency Lock Invariant: Concurrent parallel sales prevent race conditions", async () => {
    // 1. Seed Company Account with exactly 10 units
    await InventoryService.recordPurchase({
      actorId: "44444444-4444-4444-4444-444444444444",
      actorName: "Test Suite",
      supplier: "Test Supplier",
      purchaseDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 10,
          unitCost: 50.0,
        },
      ],
    });

    // 2. Run 10 sales of 1 unit in parallel using Promise.all
    const promises = Array.from({ length: 10 }).map((_, idx) => {
      return InventoryService.recordSale({
        actorType: ActorType.USER,
        actorId: "44444444-4444-4444-4444-444444444444",
        actorName: `Test Suite Thread ${idx}`,
        saleDate: new Date(),
        items: [
          {
            productVariantId: testVariantId,
            inventoryAccountId: companyAccountId,
            quantity: 1,
            unitSalePrice: 85.0,
          },
        ],
        grossRevenue: 85.0,
        // Unique order reference to satisfy idempotency constraint
        externalOrderId: `CONCURRENT-TX-${idx}`,
        marketplaceId: "SHOPIFY" as const,
      });
    });

    const results = await Promise.allSettled(promises);
    const fulfilled = results.filter((r) => r.status === "fulfilled");

    // All 10 parallel sales must be processed correctly, resolving sequentially under row locks
    expect(fulfilled.length).toBe(10);

    // Verify final stock count is exactly 0
    const finalBalance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    expect(finalBalance?.quantity).toBe(0);
  });
});
