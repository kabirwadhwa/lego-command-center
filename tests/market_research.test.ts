import { prisma } from "@/lib/prisma";
import {
  MarketResearchService,
  normalizeSetNumber,
  isValidSetNumber,
  resolveProductMetadata,
} from "@/services/pricing/marketResearchService";
import { PriceEngineService } from "@/services/pricing/priceEngineService";
import {
  getFeeStructure,
  calculateBreakevenFloor,
  calculateChannelProceeds,
} from "@/services/pricing/feeService";
import { researchLegoSetAction } from "@/app/actions/marketplaceActions";
import { PriceType, ObservationProvenance, UserRole } from "@prisma/client";

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

// Mock auth getCurrentUser and checkRole
const mockGetCurrentUser = jest.fn();
jest.mock("@/lib/auth", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  checkRole: jest.fn(async () => ({
    id: "44444444-4444-4444-4444-444444444444",
    name: "Kristof",
    role: "ADMIN",
  })),
  getAppMode: jest.fn(() => "production"),
}));

describe("Market Research Service & Fee Economics", () => {
  const originalAppMode = process.env.APP_MODE;
  const testSetNumber = "99001";
  const testSeedSetNumber = "10316"; // Present in inventory-seed.json

  beforeAll(async () => {
    process.env.APP_MODE = "production";
    mockGetCurrentUser.mockResolvedValue({
      id: "44444444-4444-4444-4444-444444444444",
      name: "Kristof",
      role: UserRole.ADMIN,
    });

    await cleanupSet(testSetNumber);
  });

  afterAll(async () => {
    process.env.APP_MODE = originalAppMode;
    await cleanupSet(testSetNumber);
    await prisma.$disconnect();
  });

  async function cleanupSet(setNum: string) {
    const p = await prisma.product.findUnique({ where: { setNumber: setNum } });
    if (p) {
      await prisma.legoResearchHistory.deleteMany({ where: { setNumber: setNum } });
      await prisma.marketPriceSnapshot.deleteMany({ where: { productId: p.id } });
      await prisma.inventoryBalance.deleteMany({ where: { productVariant: { productId: p.id } } });
      await prisma.inventoryTransaction.deleteMany({ where: { productVariant: { productId: p.id } } });
      await prisma.productVariant.deleteMany({ where: { productId: p.id } });
      await prisma.product.deleteMany({ where: { id: p.id } });
    }
    await prisma.legoResearchHistory.deleteMany({ where: { setNumber: setNum } });
  }

  describe("Set Number Normalization & Validation", () => {
    it("normalizes set numbers with suffixes, prefixes, and whitespace", () => {
      expect(normalizeSetNumber("10316")).toBe("10316");
      expect(normalizeSetNumber("10316-1")).toBe("10316");
      expect(normalizeSetNumber("  10316-2  ")).toBe("10316");
      expect(normalizeSetNumber("SET-75192")).toBe("75192");
      expect(normalizeSetNumber("lgo-21330-1")).toBe("21330");
      expect(normalizeSetNumber(" 42143 ")).toBe("42143");
    });

    it("validates set numbers correctly", () => {
      expect(isValidSetNumber("10316")).toBe(true);
      expect(isValidSetNumber("10316-1")).toBe(true);
      expect(isValidSetNumber("75192")).toBe(true);
      expect(isValidSetNumber("")).toBe(false);
      expect(isValidSetNumber("   ")).toBe(false);
      expect(isValidSetNumber("12")).toBe(false); // Too short
    });
  });

  describe("Product Metadata Resolution", () => {
    it("resolves rich metadata from inventory-seed.json for known sets", async () => {
      const meta = await resolveProductMetadata(testSeedSetNumber);
      expect(meta.metadataAvailable).toBe(true);
      expect(meta.name).toContain("Rivendell");
      expect(meta.setNumber).toBe("10316");
    });

    it("falls back to generic metadata truthfully when unknown", async () => {
      const meta = await resolveProductMetadata("998877");
      expect(meta.metadataAvailable).toBe(false);
      expect(meta.name).toBe("Product metadata unavailable");
      expect(meta.theme).toBeNull();
    });
  });

  describe("Zero Inventory Invariant During Research", () => {
    it("researching an unowned set creates catalog Product with ZERO inventory balances or transactions", async () => {
      const result = await MarketResearchService.researchLegoSet({
        setNumber: testSetNumber,
        targetChannel: "CATAWIKI",
      });

      expect(result).toBeDefined();
      expect(result.setNumber).toBe(testSetNumber);

      const product = await prisma.product.findUnique({
        where: { setNumber: testSetNumber },
      });
      expect(product).not.toBeNull();

      // Invariant: ZERO inventory balances or transactions created by research
      const balanceCount = await prisma.inventoryBalance.count({
        where: { productVariant: { productId: product!.id } },
      });
      const txCount = await prisma.inventoryTransaction.count({
        where: { productVariant: { productId: product!.id } },
      });
      const purchaseCount = await prisma.purchaseItem.count({
        where: { productVariant: { productId: product!.id } },
      });
      const saleCount = await prisma.saleItem.count({
        where: { productVariant: { productId: product!.id } },
      });
      const listingCount = await prisma.marketplaceListing.count({
        where: { productVariant: { productId: product!.id } },
      });

      expect(balanceCount).toBe(0);
      expect(txCount).toBe(0);
      expect(purchaseCount).toBe(0);
      expect(saleCount).toBe(0);
      expect(listingCount).toBe(0);
    });

    it("researching an already-inventoried set preserves existing balances without adding new rows", async () => {
      const existingProduct = await prisma.product.findFirst({
        where: { variants: { some: { balances: { some: { quantity: { gt: 0 } } } } } },
        include: {
          variants: {
            include: { balances: true },
          },
        },
      });

      if (existingProduct) {
        const initialTotalQty = existingProduct.variants.reduce(
          (sum: number, v) => sum + v.balances.reduce((bSum: number, b) => bSum + b.quantity, 0),
          0
        );

        await MarketResearchService.researchLegoSet({
          setNumber: existingProduct.setNumber,
          targetChannel: "SHOPIFY",
        });

        const updatedBalances = await prisma.inventoryBalance.findMany({
          where: { productVariant: { productId: existingProduct.id } },
        });
        const updatedTotalQty = updatedBalances.reduce((sum, b) => sum + b.quantity, 0);

        expect(updatedTotalQty).toBe(initialTotalQty);
      }
    });
  });

  describe("Sample-Size Confidence Caps (Section 22 Rules)", () => {
    it("marks 0 observations as INSUFFICIENT", () => {
      const m = PriceEngineService.calculateMetrics([], []);
      expect(m.sampleSize).toBe(0);
      expect(m.confidenceTier).toBe("INSUFFICIENT");
      expect(m.confidenceScore).toBe(0);
    });

    it("marks 1 observation as strictly INSUFFICIENT", () => {
      const m = PriceEngineService.calculateMetrics([200], [new Date()]);
      expect(m.sampleSize).toBe(1);
      expect(m.confidenceTier).toBe("INSUFFICIENT");
      expect(m.confidenceScore).toBe(0);
    });

    it("caps 2 observations at LOW tier (max 40)", () => {
      const m = PriceEngineService.calculateMetrics(
        [200, 200],
        [new Date(), new Date()],
        [PriceType.SOLD_PRICE, PriceType.SOLD_PRICE]
      );
      expect(m.sampleSize).toBe(2);
      expect(m.confidenceTier).toBe("LOW");
      expect(m.confidenceScore).toBeLessThanOrEqual(40);
    });

    it("caps 3-4 observations at LOW tier (max 40)", () => {
      const prices = [198, 200, 201, 199];
      const dates = prices.map(() => new Date());
      const types = prices.map(() => PriceType.SOLD_PRICE);
      const m = PriceEngineService.calculateMetrics(prices, dates, types);

      expect(m.rawCount).toBe(4);
      expect(m.confidenceTier).toBe("LOW");
      expect(m.confidenceScore).toBeLessThanOrEqual(40);
    });

    it("allows 5-7 observations to achieve MEDIUM tier (max 75)", () => {
      const prices = [198, 200, 201, 199, 202, 200];
      const dates = prices.map(() => new Date());
      const types = prices.map(() => PriceType.SOLD_PRICE);
      const m = PriceEngineService.calculateMetrics(prices, dates, types);

      expect(m.rawCount).toBe(6);
      expect(m.confidenceTier).toBe("MEDIUM");
      expect(m.confidenceScore).toBeLessThanOrEqual(75);
      expect(m.confidenceScore).toBeGreaterThanOrEqual(41);
    });

    it("allows 8+ observations with completed sales to achieve HIGH tier (>= 80)", () => {
      const prices = [200, 201, 199, 200, 202, 198, 200, 201, 199];
      const dates = prices.map(() => new Date());
      const types = prices.map(() => PriceType.SOLD_PRICE);
      const m = PriceEngineService.calculateMetrics(prices, dates, types);

      expect(m.rawCount).toBe(9);
      expect(m.confidenceTier).toBe("HIGH");
      expect(m.confidenceScore).toBeGreaterThanOrEqual(80);
    });
  });

  describe("Hypothetical Cost Scenario vs Unknown Cost Basis", () => {
    it("calculates full channel fee breakdown, margin, breakeven, and ROI when cost is provided", () => {
      const cost = 250.0;
      const sellingPrice = 350.0;
      const catawikiFees = getFeeStructure("CATAWIKI");

      const proceeds = calculateChannelProceeds(sellingPrice, cost, catawikiFees);
      // Catawiki: 12.5% variable = 43.75, fixed = 0.00, shipping = 0.00 (buyer pays)
      expect(proceeds.variableFeeAmount).toBe(43.75);
      expect(proceeds.fixedFeeAmount).toBe(0.00);
      expect(proceeds.shippingCost).toBe(0.00);
      expect(proceeds.totalFees).toBe(43.75);
      expect(proceeds.netProceeds).toBe(306.25);

      expect(proceeds.contributionProfit).toBe(56.25);
      expect(proceeds.grossMarginPct).toBe(16.1);
      expect(proceeds.roiPct).toBe(22.5);

      const floor = calculateBreakevenFloor(cost, catawikiFees);
      // (250 + 0 + 0) / (1 - 0.125) = 250 / 0.875 = 285.71
      expect(floor).toBe(285.71);
      expect(proceeds.breakevenPrice).toBe(285.71);
    });

    it("truthfully leaves purchaseScenario null when purchase cost is omitted", async () => {
      const product = await prisma.product.findUnique({ where: { setNumber: testSetNumber } });
      if (product) {
        for (const p of [220, 230, 240]) {
          await prisma.marketPriceSnapshot.create({
            data: {
              productId: product.id,
              marketplace: "CATAWIKI",
              price: p,
              priceType: PriceType.SOLD_PRICE,
              provenance: ObservationProvenance.LIVE_SCRAPE,
              capturedAt: new Date(),
            },
          });
        }
      }

      const resultNoCost = await MarketResearchService.researchLegoSet({
        setNumber: testSetNumber,
        targetChannel: "CATAWIKI",
      });

      expect(resultNoCost.purchaseScenario).toBeNull();
      expect(resultNoCost.medianPrice).toBe(230);
    });
  });

  describe("6-Hour Freshness Caching & Research History", () => {
    it("records research in LegoResearchHistory and marks entries within 6h as fresh", async () => {
      await MarketResearchService.researchLegoSet({
        setNumber: testSetNumber,
        targetChannel: "CATAWIKI",
        hypotheticalCost: 150,
      });

      const history = await MarketResearchService.getRecentResearches(10);
      const entry = history.find((h) => h.setNumber === testSetNumber);

      expect(entry).toBeDefined();
      expect(entry?.isStale).toBe(false);
      expect(entry?.observationCount).toBeGreaterThanOrEqual(1);
    });

    it("marks research history older than 6 hours as stale", async () => {
      const staleSet = "99002";
      await prisma.legoResearchHistory.deleteMany({ where: { setNumber: staleSet } });

      const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
      await prisma.legoResearchHistory.create({
        data: {
          setNumber: staleSet,
          productName: "Stale Test Set",
          theme: "Icons",
          marketMedian: 180,
          confidenceTier: "LOW",
          observationCount: 3,
          researchedAt: sevenHoursAgo,
        },
      });

      const history = await MarketResearchService.getRecentResearches(20);
      const entry = history.find((h) => h.setNumber === staleSet);

      expect(entry).toBeDefined();
      expect(entry?.isStale).toBe(true);

      await prisma.legoResearchHistory.deleteMany({ where: { setNumber: staleSet } });
    });
  });

  describe("Server Action: researchLegoSetAction", () => {
    it("allows ADMIN, FAMILY_SELLER, and VIEWER roles to research sets", async () => {
      for (const role of [UserRole.ADMIN, UserRole.FAMILY_SELLER, UserRole.VIEWER]) {
        mockGetCurrentUser.mockResolvedValueOnce({
          id: "test-user-id",
          name: "Test User",
          role,
        });

        const res = await researchLegoSetAction({
          setNumber: testSetNumber,
          hypotheticalCost: 150,
          targetChannel: "CATAWIKI",
        });

        expect(res.success).toBe(true);
        expect(res.data).toBeDefined();
        expect(res.data?.setNumber).toBe(testSetNumber);
      }
    });

    it("rejects invalid set numbers with descriptive validation error", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({
        id: "test-user-id",
        name: "Test User",
        role: UserRole.ADMIN,
      });

      const res = await researchLegoSetAction({
        setNumber: "",
        targetChannel: "CATAWIKI",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid LEGO set number");
    });
  });
});
