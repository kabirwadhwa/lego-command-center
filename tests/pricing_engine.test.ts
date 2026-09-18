import prisma from "@/lib/prisma";
import {
  PriceEngineService,
  calculateBreakevenFloor,
  MARKETPLACE_FEES
} from "@/services/pricing/priceEngineService";
import { CatawikiScraperService } from "@/services/scraper/catawikiScraper";
import {
  AlertType,
  ObservationProvenance,
  PriceType,
  Product,
  ProductVariant,
  InventoryAccount
} from "@prisma/client";

describe("PriceEngineService & CatawikiScraperService", () => {
  const originalEnv = process.env.APP_MODE;
  const originalApifyToken = process.env.APIFY_API_TOKEN;

  beforeAll(async () => {
    // Setup test environment: ensure unit tests do not make live external API calls
    delete process.env.APIFY_API_TOKEN;
  });

  afterAll(async () => {
    process.env.APP_MODE = originalEnv;
    if (originalApifyToken) {
      process.env.APIFY_API_TOKEN = originalApifyToken;
    }
    await prisma.$disconnect();
  });

  describe("Statistical Metrics & Outlier Removal", () => {
    it("correctly trims outliers from samples >= 4", () => {
      // 5 values with extreme low and high outliers: [50, 190, 200, 210, 500]
      // Trimming removes 50 and 500 -> remaining: [190, 200, 210]
      const prices = [50, 190, 200, 210, 500];
      const dates = prices.map(() => new Date());
      const metrics = PriceEngineService.calculateMetrics(prices, dates);

      expect(metrics.rawCount).toBe(5);
      expect(metrics.sampleSize).toBe(3);
      expect(metrics.median).toBe(200);
      expect(metrics.mean).toBe(200);
      expect(metrics.min).toBe(190);
      expect(metrics.max).toBe(210);
      expect(metrics.stdDev).toBeCloseTo(8.16, 1);
    });

    it("calculates accurate median on even sample count without trimming", () => {
      const prices = [100, 200];
      const dates = [new Date(), new Date()];
      const metrics = PriceEngineService.calculateMetrics(prices, dates);

      expect(metrics.sampleSize).toBe(2);
      expect(metrics.median).toBe(150);
      expect(metrics.mean).toBe(150);
    });

    it("computes high confidence score for large recent samples with tight spread and completed sales", () => {
      const prices = [198, 200, 201, 199, 202, 200, 201, 199];
      const dates = prices.map(() => new Date(Date.now() - 3600000)); // 1 hour ago
      const types = [
        PriceType.SOLD_PRICE,
        PriceType.SOLD_PRICE,
        PriceType.SOLD_PRICE,
        PriceType.SOLD_PRICE,
        PriceType.CURRENT_BID,
        PriceType.CURRENT_BID,
        PriceType.CURRENT_BID,
        PriceType.CURRENT_BID,
      ];
      const metrics = PriceEngineService.calculateMetrics(prices, dates, types);

      expect(metrics.confidenceScore).toBeGreaterThanOrEqual(80);
      expect(metrics.confidenceTier).toBe("HIGH");
      expect(metrics.datePenalized).toBe(false);
    });

    it("penalizes missing or unparseable captured dates", () => {
      const prices = [198, 200, 201, 199, 202];
      // Pass empty dates array
      const metricsNoDates = PriceEngineService.calculateMetrics(prices, []);
      expect(metricsNoDates.datePenalized).toBe(true);

      // Pass invalid dates
      const metricsInvalidDates = PriceEngineService.calculateMetrics(
        prices,
        [new Date(), null, undefined, "invalid-date" as unknown as Date, new Date()]
      );
      expect(metricsInvalidDates.datePenalized).toBe(true);
      // Penalized score is lower than with valid recent dates
      const metricsValidDates = PriceEngineService.calculateMetrics(prices, prices.map(() => new Date()));
      expect(metricsInvalidDates.confidenceScore).toBeLessThan(metricsValidDates.confidenceScore);
    });

    it("penalizes stale market data over 45 days old", () => {
      const prices = [198, 200, 201, 199, 202];
      const staleDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000); // 50 days old
      const metricsStale = PriceEngineService.calculateMetrics(prices, prices.map(() => staleDate));
      const metricsFresh = PriceEngineService.calculateMetrics(prices, prices.map(() => new Date()));

      expect(metricsStale.confidenceScore).toBeLessThan(metricsFresh.confidenceScore);
    });

    it("marks single observation as strictly INSUFFICIENT evidence", () => {
      const metrics = PriceEngineService.calculateMetrics([250], [new Date()]);
      expect(metrics.rawCount).toBe(1);
      expect(metrics.confidenceScore).toBe(0);
      expect(metrics.confidenceTier).toBe("INSUFFICIENT");
    });
  });

  describe("Marketplace Fee Models & Breakeven Floor", () => {
    it("defines fee models for all supported channels", () => {
      expect(MARKETPLACE_FEES.SHOPIFY).toBeDefined();
      expect(MARKETPLACE_FEES.BOL).toBeDefined();
      expect(MARKETPLACE_FEES.CATAWIKI).toBeDefined();
      expect(MARKETPLACE_FEES.EBAY).toBeDefined();
      expect(MARKETPLACE_FEES.BRICKLINK).toBeDefined();
      expect(MARKETPLACE_FEES.DEFAULT).toBeDefined();
    });

    it("calculates breakeven floor correctly using channel fees", () => {
      const cost = 100.0;
      // Bol: 15% variable fee, 0 fixed fee, 6.50 shipping
      // breakevenFloor = (100 + 0 + 6.50) / (1 - 0.15) = 106.50 / 0.85 = 125.29
      const bolFloor = calculateBreakevenFloor(cost, MARKETPLACE_FEES.BOL);
      expect(bolFloor).toBe(125.29);

      // Shopify: 2.9% variable, 0.30 fixed, 0 shipping
      // breakevenFloor = (100 + 0.30 + 0) / (1 - 0.029) = 100.30 / 0.971 = 103.30
      const shopifyFloor = calculateBreakevenFloor(cost, MARKETPLACE_FEES.SHOPIFY);
      expect(shopifyFloor).toBe(103.3);
    });

    it("returns null breakeven floor for unknown or non-positive cost", () => {
      expect(calculateBreakevenFloor(null)).toBeNull();
      expect(calculateBreakevenFloor(0)).toBeNull();
      expect(calculateBreakevenFloor(-10)).toBeNull();
    });
  });

  describe("Catawiki Scraper Integration & Provenance", () => {
    it("does NOT fabricate synthetic observations in production mode", async () => {
      process.env.APP_MODE = "production";
      const setNumber = "10330";
      const observations = await CatawikiScraperService.fetchMarketObservations(setNumber, 150.0, 6);
      // Apify is not configured in test environment -> must return empty array, never synthetic data
      expect(observations).toEqual([]);
    });

    it("does NOT fabricate synthetic observations even in demo mode", async () => {
      process.env.APP_MODE = "demo";
      const setNumber = "10330";
      const observations = await CatawikiScraperService.fetchMarketObservations(setNumber, 150.0, 4);
      // Absolute invariant: no simulated data anywhere in application runtime
      expect(observations).toEqual([]);
    });

    it("parses Apify dataset items and enforces exact set number boundary matching", () => {
      const rawMockItems = [
        { id: "lot-1", title: "LEGO Icons 10330 Concorde Sealed", currentBid: 185.0, currency: "EUR" },
        { id: "lot-2", title: "LEGO 1033 Vintage Car (Wrong Set)", currentBid: 40.0, currency: "EUR" },
        { id: "lot-3", title: "LEGO 103301 Space Shuttle (Wrong Set)", currentBid: 300.0, currency: "EUR" },
        { id: "lot-4", title: "Lot with LEGO 10330 Concorde In Box", soldPrice: 210.0, currency: "EUR" }
      ];

      const parsed = CatawikiScraperService.parseApifyDataset(rawMockItems, "10330");
      expect(parsed.length).toBe(2);
      expect(parsed[0].price).toBe(185.0);
      expect(parsed[0].priceType).toBe("CURRENT_BID");
      expect(parsed[1].price).toBe(210.0);
      expect(parsed[1].priceType).toBe("SOLD_PRICE");
    });
  });

  describe("End-to-End Pricing Engine Evaluation", () => {
    let testProduct: Product;
    let testVariant: ProductVariant;
    let testAccount: InventoryAccount;

    beforeAll(async () => {
      process.env.APP_MODE = "production";

      // Clean up any residual test data from previous runs
      const existing = await prisma.product.findUnique({ where: { setNumber: "T-10330" } });
      if (existing) {
        await prisma.alert.deleteMany({ where: { productVariant: { productId: existing.id } } });
        await prisma.priceRecommendation.deleteMany({ where: { productVariant: { productId: existing.id } } });
        await prisma.inventoryBalance.deleteMany({ where: { productVariant: { productId: existing.id } } });
        await prisma.productVariant.deleteMany({ where: { productId: existing.id } });
        await prisma.marketPriceSnapshot.deleteMany({ where: { productId: existing.id } });
        await prisma.product.deleteMany({ where: { id: existing.id } });
      }

      // Create isolated test product and variant
      testProduct = await prisma.product.create({
        data: {
          name: "Test Concorde Supersonic",
          setNumber: "T-10330",
          theme: "Icons"
        }
      });

      testVariant = await prisma.productVariant.create({
        data: {
          productId: testProduct.id,
          sku: "TEST-10330-NEW",
          condition: "NEW_SEALED"
        }
      });

      // Get or create company inventory account
      const existingAccount = await prisma.inventoryAccount.findFirst({
        where: { type: "COMPANY" }
      });
      if (existingAccount) {
        testAccount = existingAccount;
      } else {
        testAccount = await prisma.inventoryAccount.create({
          data: { name: "Company Central", type: "COMPANY" }
        });
      }

      // Create inventory balance with known cost: 5 units @ €120.00
      await prisma.inventoryBalance.create({
        data: {
          productVariantId: testVariant.id,
          inventoryAccountId: testAccount.id,
          quantity: 5,
          averageCost: 120.0,
          knownCostQuantity: 5,
          knownCostTotal: 600.0
        }
      });
    });

    afterAll(async () => {
      // Clean up test records in correct dependency order
      if (testProduct) {
        await prisma.alert.deleteMany({ where: { productVariant: { productId: testProduct.id } } });
        await prisma.priceRecommendation.deleteMany({ where: { productVariant: { productId: testProduct.id } } });
        await prisma.inventoryBalance.deleteMany({ where: { productVariant: { productId: testProduct.id } } });
        await prisma.productVariant.deleteMany({ where: { productId: testProduct.id } });
        await prisma.marketPriceSnapshot.deleteMany({ where: { productId: testProduct.id } });
        await prisma.product.deleteMany({ where: { id: testProduct.id } });
      }
    });

    it("returns INSUFFICIENT_DATA and raises alert when genuine observations < 2", async () => {
      process.env.APP_MODE = "production";
      // Zero observations exist currently
      const result = await PriceEngineService.evaluateVariant(testVariant.id);
      expect(result).not.toBeNull();
      expect(result?.status).toBe("INSUFFICIENT_DATA");
      expect(result?.confidenceTier).toBe("INSUFFICIENT");
      expect(result?.recommendedPrice).toBe(0);

      // Verify alert was created in database
      const alert = await prisma.alert.findFirst({
        where: {
          productVariantId: testVariant.id,
          type: AlertType.INSUFFICIENT_MARKET_EVIDENCE
        }
      });
      expect(alert).not.toBeNull();
      expect(alert?.type).toBe(AlertType.INSUFFICIENT_MARKET_EVIDENCE);
    });

    it("excludes SIMULATED observations in production evaluation", async () => {
      process.env.APP_MODE = "production";

      // Seed 5 SIMULATED observations
      for (let i = 0; i < 5; i++) {
        await prisma.marketPriceSnapshot.create({
          data: {
            productId: testProduct.id,
            marketplace: "CATAWIKI",
            price: 200 + i * 5,
            priceType: PriceType.CURRENT_BID,
            provenance: ObservationProvenance.SIMULATED,
            capturedAt: new Date()
          }
        });
      }

      // In production mode, SIMULATED snapshots must be ignored -> still INSUFFICIENT_DATA
      const result = await PriceEngineService.evaluateVariant(testVariant.id);
      expect(result?.status).toBe("INSUFFICIENT_DATA");
      expect(result?.recommendedPrice).toBe(0);
    });

    it("evaluates variant and creates recommendation when genuine observations exist", async () => {
      process.env.APP_MODE = "production";

      // Seed 4 genuine LIVE_SCRAPE observations
      const genuinePrices = [190, 195, 200, 205];
      for (const p of genuinePrices) {
        await prisma.marketPriceSnapshot.create({
          data: {
            productId: testProduct.id,
            marketplace: "CATAWIKI",
            price: p,
            priceType: PriceType.SOLD_PRICE,
            provenance: ObservationProvenance.LIVE_SCRAPE,
            capturedAt: new Date()
          }
        });
      }

      const result = await PriceEngineService.evaluateVariant(testVariant.id, { channel: "SHOPIFY" });
      expect(result).not.toBeNull();
      expect(result?.recommendedPrice).toBeGreaterThan(150);
      expect(result?.confidenceScore).toBeGreaterThanOrEqual(40);
      expect(result?.confidenceTier).not.toBe("INSUFFICIENT");
      expect(result?.cost).toBe(120);
      expect(result?.costBasisStatus).toBe("FULLY_KNOWN");

      // Verify persisted recommendation
      const dbRec = await prisma.priceRecommendation.findFirst({
        where: { productVariantId: testVariant.id }
      });
      expect(dbRec).not.toBeNull();
      expect(Number(dbRec?.recommendedPrice)).toBe(result?.recommendedPrice);
    });

    it("handles unknown acquisition cost truthfully without fabricating €0.00 COGS", async () => {
      // Create a variant with 10 units of unknown cost
      const unknownVariant = await prisma.productVariant.create({
        data: {
          productId: testProduct.id,
          sku: "TEST-10330-UNKNOWN",
          condition: "USED_COMPLETE"
        }
      });

      await prisma.inventoryBalance.create({
        data: {
          productVariantId: unknownVariant.id,
          inventoryAccountId: testAccount.id,
          quantity: 10,
          averageCost: null,
          knownCostQuantity: 0,
          knownCostTotal: 0.0
        }
      });

      const result = await PriceEngineService.evaluateVariant(unknownVariant.id);
      expect(result).not.toBeNull();
      expect(result?.cost).toBeNull();
      expect(result?.costBasisStatus).toBe("COMPLETELY_UNKNOWN");
      // Recommended price is based on genuine market observations
      expect(result?.recommendedPrice).toBeGreaterThan(150);
      expect(result?.reasoning).toContain("Cost basis: Unknown");

      // Cleanup
      await prisma.priceRecommendation.deleteMany({ where: { productVariantId: unknownVariant.id } });
      await prisma.inventoryBalance.deleteMany({ where: { productVariantId: unknownVariant.id } });
      await prisma.productVariant.deleteMany({ where: { id: unknownVariant.id } });
    });
  });
});
