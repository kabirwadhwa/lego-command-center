import { prisma, pool } from "@/lib/prisma";
import { InventoryService } from "@/services/inventoryService";
import { MarketplaceType, ActorType, ProductCondition } from "@prisma/client";

describe("Strict Financial Accounting and Null Propagation tests", () => {
  let companyAccountId: string;
  let testVariantId: string;
  const testSku = "LGO-FIN-TEST";

  beforeAll(async () => {
    // Resolve Company Account
    const companyAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY", status: "ACTIVE" },
    });
    if (!companyAcc) throw new Error("Company account not found.");
    companyAccountId = companyAcc.id;

    // Create a product variant
    let product = await prisma.product.findUnique({
      where: { setNumber: "88888" },
    });
    if (!product) {
      product = await prisma.product.create({
        data: {
          setNumber: "88888",
          name: "Financial Test Set",
          theme: "Technic",
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
  });

  afterAll(async () => {
    const product = await prisma.product.findUnique({
      where: { setNumber: "88888" },
    });
    if (product) {
      await prisma.saleItem.deleteMany({
        where: { productVariant: { productId: product.id } },
      });
      await prisma.sale.deleteMany({
        where: { externalOrderId: "FIN-ORDER-TEST" },
      });
      await prisma.inventoryTransaction.deleteMany({
        where: { productVariant: { productId: product.id } },
      });
      await prisma.inventoryBalance.deleteMany({
        where: { productVariant: { productId: product.id } },
      });
      await prisma.productVariant.deleteMany({
        where: { productId: product.id },
      });
      await prisma.product.delete({
        where: { id: product.id },
      });
    }
    await prisma.$disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    await prisma.saleItem.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.sale.deleteMany({
      where: { externalOrderId: "FIN-ORDER-TEST" },
    });
    await prisma.inventoryTransaction.deleteMany({
      where: { productVariantId: testVariantId },
    });
    await prisma.inventoryBalance.deleteMany({
      where: { productVariantId: testVariantId },
    });
  });

  test("unknown cost does not become zero, stays null in database balance", async () => {
    // 1. Adjust stock with a null/unknown cost
    await InventoryService.adjustStock({
      productVariantId: testVariantId,
      inventoryAccountId: companyAccountId,
      type: "MANUAL_ADJUSTMENT",
      quantityChange: 10,
      unitCost: null, // Unknown cost
      actorId: "test-user",
      actorName: "Test User",
    });

    const balance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    expect(balance).not.toBeNull();
    // Verify cost remains null (unknown), not 0.00
    expect(balance?.averageCost).toBeNull();
  });

  test("zero remains supported when actual known value is genuinely €0", async () => {
    // 1. Adjust stock with a known €0 cost (e.g. promotional gift)
    await InventoryService.adjustStock({
      productVariantId: testVariantId,
      inventoryAccountId: companyAccountId,
      type: "MANUAL_ADJUSTMENT",
      quantityChange: 5,
      unitCost: 0.00, // Genuinely free/zero cost
      actorId: "test-user",
      actorName: "Test User",
    });

    const balance = await prisma.inventoryBalance.findUnique({
      where: {
        productVariantId_inventoryAccountId: {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
        },
      },
    });

    expect(balance).not.toBeNull();
    expect(Number(balance?.averageCost)).toBe(0.00); // Known €0.00
  });

  test("unknown fee does not become zero, stays null in database sale record", async () => {
    // Seed a known stock balance so the sale can succeed
    await prisma.inventoryBalance.create({
      data: {
        productVariantId: testVariantId,
        inventoryAccountId: companyAccountId,
        quantity: 10,
        averageCost: 50.00,
      },
    });

    await InventoryService.recordSale({
      actorType: ActorType.USER,
      actorId: "test-user",
      actorName: "Test User",
      marketplaceId: MarketplaceType.SHOPIFY,
      externalOrderId: "FIN-ORDER-TEST",
      saleDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 2,
          unitSalePrice: 120.00,
        },
      ],
      grossRevenue: 240.00,
      marketplaceFees: null, // Unknown fees (should stay null)
      shippingRevenue: 0.00,
      discount: 0.00,
      notes: "Test order with unknown fee",
    });

    const sale = await prisma.sale.findUnique({
      where: {
        marketplaceId_externalOrderId: {
          marketplaceId: MarketplaceType.SHOPIFY,
          externalOrderId: "FIN-ORDER-TEST",
        },
      },
    });

    expect(sale).not.toBeNull();
    expect(sale?.marketplaceFees).toBeNull();
    expect(sale?.netRevenue).toBeNull(); // null netRevenue due to unknown fee null propagation
  });

  test("unknown cost does not produce artificial 100% margin", async () => {
    // Seed stock with null/unknown average cost
    await prisma.inventoryBalance.create({
      data: {
        productVariantId: testVariantId,
        inventoryAccountId: companyAccountId,
        quantity: 10,
        averageCost: null, // Unknown cost
      },
    });

    await InventoryService.recordSale({
      actorType: ActorType.USER,
      actorId: "test-user",
      actorName: "Test User",
      marketplaceId: MarketplaceType.SHOPIFY,
      externalOrderId: "FIN-ORDER-TEST",
      saleDate: new Date(),
      items: [
        {
          productVariantId: testVariantId,
          inventoryAccountId: companyAccountId,
          quantity: 2,
          unitSalePrice: 120.00,
        },
      ],
      grossRevenue: 240.00,
      marketplaceFees: 10.00, // Known fee
      shippingRevenue: 0.00,
      discount: 0.00,
      notes: "Test order with unknown cost basis",
    });

    const saleItem = await prisma.saleItem.findFirst({
      where: { productVariantId: testVariantId },
    });

    expect(saleItem).not.toBeNull();
    expect(saleItem?.unitCostAtSale).toBeNull(); // Unknown COGS basis propagation
  });
});
