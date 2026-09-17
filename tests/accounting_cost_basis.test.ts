import { prisma, pool } from "@/lib/prisma";
import { InventoryService } from "@/services/inventoryService";
import { ActorType, InventoryTransactionType, ProductCondition } from "@prisma/client";

describe("Unknown-Cost Inventory Accounting & Cost Basis Invariant Tests", () => {
  let testVariantId: string;
  let companyAccountId: string;
  let personalAccountId: string;
  const testSku = "LGO-77777-ACCOUNTING-TEST";

  beforeAll(async () => {
    let product = await prisma.product.findUnique({
      where: { setNumber: "77777" },
    });

    if (!product) {
      product = await prisma.product.create({
        data: {
          setNumber: "77777",
          name: "Accounting Invariant Test Set",
          theme: "Architecture",
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

  afterAll(async () => {
    await prisma.inventoryBalance.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.inventoryTransaction.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.saleItem.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.purchaseItem.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.productVariant.deleteMany({ where: { id: testVariantId } });
    await prisma.product.deleteMany({ where: { setNumber: "77777" } });
    await prisma.$disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    await prisma.inventoryBalance.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.inventoryTransaction.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.saleItem.deleteMany({ where: { productVariantId: testVariantId } });
    await prisma.purchaseItem.deleteMany({ where: { productVariantId: testVariantId } });
  });

  test("CRITICAL INVARIANT: Unknown-cost inventory MUST NOT dilute known average cost to zero or half", async () => {
    // 1. Initial known purchase: 10 units @ €100 each
    await InventoryService.recordPurchase({
      actorId: "test-actor-1",
      actorName: "Auditor",
      supplier: "Wholesale Dist",
      purchaseDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 10,
          unitCost: 100.0,
        },
      ],
    });

    let balance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    expect(balance).not.toBeNull();
    expect(balance?.quantity).toBe(10);
    expect(balance?.knownCostQuantity).toBe(10);
    expect(Number(balance?.averageCost)).toBe(100.0);
    expect(Number(balance?.knownCostTotal)).toBe(1000.0);

    let status = InventoryService.getCostBasisStatus(balance!);
    expect(status.status).toBe("FULLY_KNOWN");
    expect(status.averageKnownCost).toBe(100.0);

    // 2. Adjust or import 10 units with UNKNOWN cost (unitCost = null)
    await InventoryService.adjustStock({
      actorId: "test-actor-1",
      actorName: "Auditor",
      productVariantId: testVariantId,
      inventoryAccountId: companyAccountId,
      type: InventoryTransactionType.MANUAL_ADJUSTMENT,
      quantityChange: 10,
      unitCost: null, // Unknown cost!
      notes: "Found 10 units in unlabelled warehouse box without invoice",
    });

    balance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    // Total quantity is now 20 (10 known + 10 unknown)
    expect(balance?.quantity).toBe(20);
    expect(balance?.knownCostQuantity).toBe(10);
    expect(Number(balance?.knownCostTotal)).toBe(1000.0);

    // CRITICAL REQUIREMENT: Average known cost MUST REMAIN €100.00, NEVER €50.00!
    expect(Number(balance?.averageCost)).toBe(100.0);
    expect(Number(balance?.averageCost)).not.toBe(50.0);

    status = InventoryService.getCostBasisStatus(balance!);
    expect(status.status).toBe("PARTIALLY_KNOWN");
    expect(status.knownQuantity).toBe(10);
    expect(status.totalQuantity).toBe(20);
    expect(status.averageKnownCost).toBe(100.0);
  });

  test("Sales involving unknown-cost inventory do not invent false COGS", async () => {
    // 1. Setup 5 units with completely unknown cost
    await InventoryService.adjustStock({
      actorId: "test-actor-1",
      actorName: "Auditor",
      productVariantId: testVariantId,
      inventoryAccountId: companyAccountId,
      type: InventoryTransactionType.STOCK_COUNT_CORRECTION,
      quantityChange: 5,
      unitCost: null,
    });

    const balance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });
    expect(balance?.quantity).toBe(5);
    expect(balance?.knownCostQuantity).toBe(0);
    expect(balance?.averageCost).toBeNull();

    const status = InventoryService.getCostBasisStatus(balance!);
    expect(status.status).toBe("COMPLETELY_UNKNOWN");
    expect(status.averageKnownCost).toBeNull();

    // 2. Sell 2 units
    const sale = await InventoryService.recordSale({
      actorType: ActorType.USER,
      actorId: "test-actor-1",
      actorName: "Auditor",
      saleDate: new Date(),
      grossRevenue: 300.0,
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 2,
          unitSalePrice: 150.0,
        },
      ],
    });

    const saleItem = await prisma.saleItem.findFirst({
      where: { saleId: sale.id },
    });

    // Invariant: unitCostAtSale MUST NOT be 0.00; it must be NULL to signify unknown COGS
    expect(saleItem?.unitCostAtSale).toBeNull();
  });

  test("Transfers preserve exact known value and unknown unit counts across double-entry legs", async () => {
    // 1. Initial 10 units @ €80 on Company account
    await InventoryService.recordPurchase({
      actorId: "test-actor-1",
      actorName: "Auditor",
      supplier: "Distributor B",
      purchaseDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 10,
          unitCost: 80.0,
        },
      ],
    });

    // 2. Transfer 4 units to Personal account
    await InventoryService.transferStock({
      actorId: "test-actor-1",
      actorName: "Auditor",
      productVariantId: testVariantId,
      sourceAccountId: companyAccountId,
      destinationAccountId: personalAccountId,
      quantity: 4,
    });

    const compBalance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    const persBalance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: personalAccountId,
        },
      },
    });

    expect(compBalance?.quantity).toBe(6);
    expect(compBalance?.knownCostQuantity).toBe(6);
    expect(Number(compBalance?.averageCost)).toBe(80.0);
    expect(Number(compBalance?.knownCostTotal)).toBe(480.0);

    expect(persBalance?.quantity).toBe(4);
    expect(persBalance?.knownCostQuantity).toBe(4);
    expect(Number(persBalance?.averageCost)).toBe(80.0);
    expect(Number(persBalance?.knownCostTotal)).toBe(320.0);

    // Sum of values across both accounts is 480 + 320 = 800 (exactly conserved)
    expect(Number(compBalance?.knownCostTotal) + Number(persBalance?.knownCostTotal)).toBe(800.0);
  });
});
