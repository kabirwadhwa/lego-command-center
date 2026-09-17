import { prisma } from "@/lib/prisma";
import { InventoryService } from "@/services/inventoryService";
import {
  addResearchedSetToInventoryAction,
  addManualLegoStockAction,
} from "@/app/actions/marketplaceActions";
import { ProductCondition, InventoryTransactionType, UserRole } from "@prisma/client";

// Mock Next.js cache and headers
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

// Mock auth checkRole
const mockCheckRole = jest.fn();
jest.mock("@/lib/auth", () => ({
  checkRole: (...args: unknown[]) => mockCheckRole(...args),
  getCurrentUser: jest.fn(async () => ({
    id: "44444444-4444-4444-4444-444444444444",
    name: "Kristof",
    role: UserRole.ADMIN,
  })),
  getAppMode: jest.fn(() => "production"),
}));

describe("Stock Intake & Double-Entry Ledger Invariants", () => {
  const originalAppMode = process.env.APP_MODE;
  let companyAccountId: string;
  let personalAccountId: string;

  const testSetA = "98001";
  const testSetB = "98002";
  const actor = {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Kristof",
  };

  beforeAll(async () => {
    process.env.APP_MODE = "production";
    mockCheckRole.mockResolvedValue({
      id: actor.id,
      name: actor.name,
      role: UserRole.ADMIN,
    });

    const companyAcc = await prisma.inventoryAccount.findFirst({ where: { type: "COMPANY" } });
    const personalAcc = await prisma.inventoryAccount.findFirst({ where: { type: "PERSONAL" } });

    if (!companyAcc || !personalAcc) {
      throw new Error("Seed accounts required for tests");
    }
    companyAccountId = companyAcc.id;
    personalAccountId = personalAcc.id;

    await cleanupTestSets();
  });

  afterAll(async () => {
    process.env.APP_MODE = originalAppMode;
    await cleanupTestSets();
    await prisma.$disconnect();
  });

  async function cleanupTestSets() {
    for (const s of [testSetA, testSetB]) {
      const p = await prisma.product.findUnique({ where: { setNumber: s } });
      if (p) {
        await prisma.inventoryTransaction.deleteMany({ where: { productVariant: { productId: p.id } } });
        await prisma.inventoryBalance.deleteMany({ where: { productVariant: { productId: p.id } } });
        await prisma.priceRecommendation.deleteMany({ where: { productVariant: { productId: p.id } } });
        await prisma.productVariant.deleteMany({ where: { productId: p.id } });
        await prisma.product.deleteMany({ where: { id: p.id } });
      }
    }
  }

  describe("InventoryService.intakeStock", () => {
    it("intakes new sealed stock with known unit cost basis", async () => {
      const result = await InventoryService.intakeStock({
        actorId: actor.id,
        actorName: actor.name,
        setNumber: testSetA,
        sku: `LGO-${testSetA}-NEW`,
        productName: "Modular Intake Test",
        theme: "Creator Expert",
        condition: ProductCondition.NEW_SEALED,
        quantity: 3,
        inventoryAccountId: companyAccountId,
        unitCost: 150.0,
        notes: "Initial intake batch",
      });

      expect(result.product.setNumber).toBe(testSetA);
      expect(result.variant.condition).toBe(ProductCondition.NEW_SEALED);
      expect(result.variant.sku).toBe(`LGO-${testSetA}-NEW`);
      expect(result.balance.quantity).toBe(3);
      expect(Number(result.balance.averageCost)).toBe(150.0);
      expect(result.balance.knownCostQuantity).toBe(3);
      expect(Number(result.balance.knownCostTotal)).toBe(450.0);

      // Verify transaction ledger entry
      expect(result.transaction.type).toBe(InventoryTransactionType.PURCHASE);
      expect(result.transaction.quantity).toBe(3);
      expect(Number(result.transaction.unitCost)).toBe(150.0);
    });

    it("blends weighted average cost basis when additional known-cost units arrive", async () => {
      // Add 2 more units @ €200.00
      // Previous: 3 units @ €150.00 = €450.00
      // New: 2 units @ €200.00 = €400.00
      // Total: 5 units, total known cost: €850.00, new average cost: €170.00
      const result = await InventoryService.intakeStock({
        actorId: actor.id,
        actorName: actor.name,
        setNumber: testSetA,
        sku: `LGO-${testSetA}-NEW`,
        condition: ProductCondition.NEW_SEALED,
        quantity: 2,
        inventoryAccountId: companyAccountId,
        unitCost: 200.0,
      });

      expect(result.balance.quantity).toBe(5);
      expect(result.balance.knownCostQuantity).toBe(5);
      expect(Number(result.balance.knownCostTotal)).toBe(850.0);
      expect(Number(result.balance.averageCost)).toBe(170.0);
      expect(result.transaction.quantity).toBe(2);
      expect(Number(result.transaction.unitCost)).toBe(200.0);
    });

    it("preserves known average cost basis without dilution when units with unknown cost arrive", async () => {
      // Add 2 units with unknown cost (null)
      // Balance should be: quantity 7, knownCostQuantity 5, knownCostTotal 850.0, averageCost STILL 170.0!
      const result = await InventoryService.intakeStock({
        actorId: actor.id,
        actorName: actor.name,
        setNumber: testSetA,
        sku: `LGO-${testSetA}-NEW`,
        condition: ProductCondition.NEW_SEALED,
        quantity: 2,
        inventoryAccountId: companyAccountId,
        unitCost: null,
      });

      expect(result.balance.quantity).toBe(7);
      expect(result.balance.knownCostQuantity).toBe(5);
      expect(Number(result.balance.knownCostTotal)).toBe(850.0);
      expect(Number(result.balance.averageCost)).toBe(170.0); // NOT diluted, NOT zeroed out!
      expect(result.transaction.quantity).toBe(2);
      expect(result.transaction.unitCost).toBeNull();
    });

    it("creates custom SKU when provided", async () => {
      const customSku = `CUSTOM-${testSetA}-SPECIAL`;
      const result = await InventoryService.intakeStock({
        actorId: actor.id,
        actorName: actor.name,
        setNumber: testSetA,
        sku: customSku,
        condition: ProductCondition.USED_COMPLETE,
        quantity: 1,
        inventoryAccountId: personalAccountId,
        unitCost: 110.0,
      });

      expect(result.variant.sku).toBe(customSku);
      expect(result.variant.condition).toBe(ProductCondition.USED_COMPLETE);
      expect(result.balance.quantity).toBe(1);
    });

    it("atomically rejects intake if SKU collides with another product", async () => {
      await expect(
        InventoryService.intakeStock({
          actorId: actor.id,
          actorName: actor.name,
          setNumber: testSetB,
          sku: `LGO-${testSetA}-NEW`, // Collision with testSetA!
          productName: "Colliding Set B",
          condition: ProductCondition.NEW_SEALED,
          quantity: 1,
          inventoryAccountId: companyAccountId,
        })
      ).rejects.toThrow(/already assigned to a different product/);

      // Verify testSetB has NO balances
      const pB = await prisma.product.findUnique({ where: { setNumber: testSetB } });
      if (pB) {
        const balances = await prisma.inventoryBalance.count({
          where: { productVariant: { productId: pB.id } },
        });
        expect(balances).toBe(0);
      }
    });

    it("rejects non-positive quantities", async () => {
      await expect(
        InventoryService.intakeStock({
          actorId: actor.id,
          actorName: actor.name,
          setNumber: testSetA,
          sku: `LGO-${testSetA}-NEW`,
          condition: ProductCondition.NEW_SEALED,
          quantity: 0,
          inventoryAccountId: companyAccountId,
        })
      ).rejects.toThrow(/Intake quantity must be a positive integer/);

      await expect(
        InventoryService.intakeStock({
          actorId: actor.id,
          actorName: actor.name,
          setNumber: testSetA,
          sku: `LGO-${testSetA}-NEW`,
          condition: ProductCondition.NEW_SEALED,
          quantity: -3,
          inventoryAccountId: companyAccountId,
        })
      ).rejects.toThrow(/Intake quantity must be a positive integer/);
    });
  });

  describe("Server Action: addResearchedSetToInventoryAction & RBAC", () => {
    it("allows ADMIN and FAMILY_SELLER to intake researched stock", async () => {
      for (const role of [UserRole.ADMIN, UserRole.FAMILY_SELLER]) {
        mockCheckRole.mockResolvedValueOnce({
          id: "test-staff-id",
          name: "Staff User",
          role,
        });

        const res = await addResearchedSetToInventoryAction({
          setNumber: testSetA,
          sku: `LGO-${testSetA}-ACTION-${role}`,
          condition: ProductCondition.NEW_SEALED,
          quantity: 1,
          unitCost: 160.0,
        });

        expect(res.success).toBe(true);
        expect(res.data).toBeDefined();
        expect(res.data?.quantity).toBe(1);
      }
    });

    it("strictly blocks VIEWER from intaking stock", async () => {
      mockCheckRole.mockRejectedValueOnce(new Error("Unauthorized: Insufficient permissions"));

      const res = await addResearchedSetToInventoryAction({
        setNumber: testSetA,
        sku: `LGO-${testSetA}-VIEWER-BLOCKED`,
        condition: ProductCondition.NEW_SEALED,
        quantity: 1,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Insufficient permissions");
    });
  });

  describe("Server Action: addManualLegoStockAction & RBAC", () => {
    it("allows direct stock intake for ADMIN and FAMILY_SELLER", async () => {
      mockCheckRole.mockResolvedValueOnce({
        id: "admin-id",
        name: "Admin User",
        role: UserRole.ADMIN,
      });

      const res = await addManualLegoStockAction({
        setNumber: testSetB,
        sku: `LGO-${testSetB}-MANUAL-NEW`,
        productName: "Direct Intake Galaxy Explorer",
        theme: "Space",
        condition: ProductCondition.NEW_SEALED,
        quantity: 2,
        unitCost: 80.0,
        notes: "Direct manual intake",
      });

      expect(res.success).toBe(true);
      expect(res.data?.variant.sku).toBe(`LGO-${testSetB}-MANUAL-NEW`);
      expect(res.data?.balance.quantity).toBe(2);
    });

    it("strictly blocks VIEWER from direct stock intake", async () => {
      mockCheckRole.mockRejectedValueOnce(new Error("Unauthorized: Insufficient permissions"));

      const res = await addManualLegoStockAction({
        setNumber: testSetB,
        sku: `LGO-${testSetB}-VIEWER-DIRECT`,
        condition: ProductCondition.NEW_SEALED,
        quantity: 1,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Insufficient permissions");
    });
  });
});
