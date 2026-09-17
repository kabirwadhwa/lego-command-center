import prisma from "@/lib/prisma";
import { PriceEngineService } from "@/services/pricing/priceEngineService";
import { CatawikiScraperService } from "@/services/scraper/catawikiScraper";
import { AlertType } from "@prisma/client";

describe("PriceEngineService & CatawikiScraperService", () => {
  beforeAll(async () => {
    // Test environment
  });


  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Statistical Metrics & Outlier Removal", () => {
    it("correctly trims outliers from samples >= 4", () => {
      // 5 values with extreme low and high outliers: [50, 190, 200, 210, 500]
      // Trimming removes 50 and 500 -> remaining: [190, 200, 210]
      const prices = [50, 190, 200, 210, 500];
      const metrics = PriceEngineService.calculateMetrics(prices);

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
      const metrics = PriceEngineService.calculateMetrics(prices);

      expect(metrics.sampleSize).toBe(2);
      expect(metrics.median).toBe(150);
      expect(metrics.mean).toBe(150);
    });

    it("computes high confidence score for large recent samples with tight spread", () => {
      const prices = [198, 200, 201, 199, 202, 200, 201, 199];
      const dates = [new Date(), new Date(Date.now() - 86400000)];
      const metrics = PriceEngineService.calculateMetrics(prices, dates);

      expect(metrics.confidenceScore).toBeGreaterThanOrEqual(80);
    });
  });

  describe("Catawiki Scraper Integration", () => {
    it("generates realistic observations matching target set number", async () => {
      const setNumber = "10330";
      const observations = await CatawikiScraperService.fetchMarketObservations(setNumber, 150.0, 6);

      expect(observations.length).toBe(6);
      for (const obs of observations) {
        expect(obs.price).toBeGreaterThan(100);
        expect(obs.currency).toBe("EUR");
        expect(obs.title).toContain(setNumber);
      }
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
    it("evaluates a variant from database and creates recommendation with valid reasoning", async () => {
      // Find any variant in the database with company stock
      const variant = await prisma.productVariant.findFirst({
        where: {
          balances: {
            some: {
              inventoryAccount: { type: "COMPANY" },
              quantity: { gt: 0 }
            }
          }
        },
        include: { product: true }
      });

      expect(variant).not.toBeNull();
      if (!variant) return;

      const result = await PriceEngineService.evaluateVariant(variant.id);
      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.recommendedPrice).toBeGreaterThan(0);
      expect(result.confidenceScore).toBeGreaterThan(0);
      expect(result.reasoning).toContain("Catawiki");
      expect(result.reasoning).toContain("Confidence");

      // Verify recommendation is persisted in database
      const dbRec = await prisma.priceRecommendation.findFirst({
        where: { productVariantId: variant.id }
      });
      expect(dbRec).not.toBeNull();
      expect(Number(dbRec?.recommendedPrice)).toBe(result.recommendedPrice);
    });

    it("runs full pricing sweep and populates multiple recommendations", async () => {
      const sweep = await PriceEngineService.runFullPricingSweep(3);
      expect(sweep.processed).toBeGreaterThanOrEqual(1);
      expect(sweep.recommendationsCreated).toBeGreaterThanOrEqual(1);
    });
  });
});
