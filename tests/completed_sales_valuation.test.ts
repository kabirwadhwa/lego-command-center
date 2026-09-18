import { PriceType } from "@prisma/client";
import { CatawikiScraperService, RawApifyLotItem } from "@/services/scraper/catawikiScraper";
import { isValuationEligibleEvidence } from "@/services/pricing/evidenceEligibility";
import { PriceEngineService } from "@/services/pricing/priceEngineService";
import { ProductIdentificationService } from "@/services/catalog/productIdentificationService";

describe("Completed Sales Valuation & Catawiki Truthfulness Rules", () => {
  describe("1. Identification of Architecture Sets 21006 and 21036", () => {
    test("Identifies 21006 as LEGO_SET: The White House (Architecture)", async () => {
      const res = await ProductIdentificationService.resolveProduct("21006");
      expect(res.identifierType).toBe("LEGO_SET");
      expect(res.name).toBe("The White House");
      expect(res.theme).toBe("Architecture");
      expect(res.canonicalIdentifier).toBe("21006");
      expect(res.identificationConfidence).toBeGreaterThanOrEqual(0.9);
    });

    test("Identifies 21036 as LEGO_SET: Arc de Triomphe (Architecture)", async () => {
      const res = await ProductIdentificationService.resolveProduct("21036");
      expect(res.identifierType).toBe("LEGO_SET");
      expect(res.name).toBe("Arc de Triomphe");
      expect(res.theme).toBe("Architecture");
      expect(res.canonicalIdentifier).toBe("21036");
      expect(res.identificationConfidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("2. Condition Mapping Truthfulness (No Fake Default to USED_COMPLETE)", () => {
    test("Maps Complete set: 'No' to USED_INCOMPLETE", () => {
      const item: RawApifyLotItem = {
        id: 106072545,
        title: "LEGO Set - 21006 - Architecture - The White House",
        currentBidEUR: 36,
        sold: true,
        closed: true,
        specs: {
          Condition: "Used",
          "Complete set": "No",
        },
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([item], "21006");
      expect(parsed.lots.length).toBe(1);
      expect(parsed.lots[0].condition).toBe("USED_INCOMPLETE");
      expect(parsed.lots[0].priceType).toBe(PriceType.SOLD_PRICE);
      expect(parsed.lots[0].price).toBe(36);
    });

    test("Maps Complete set: 'Yes' to USED_COMPLETE", () => {
      const item: RawApifyLotItem = {
        id: 106260188,
        title: "LEGO Set - 21006 - Architecture - The White House",
        currentBidEUR: 35,
        sold: true,
        closed: true,
        specs: {
          Condition: "Used",
          "Complete set": "Yes",
        },
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([item], "21006");
      expect(parsed.lots.length).toBe(1);
      expect(parsed.lots[0].condition).toBe("USED_COMPLETE");
    });

    test("Does NOT default missing condition to USED_COMPLETE; maps to UNKNOWN or USED_UNKNOWN", () => {
      const item: RawApifyLotItem = {
        id: 9999,
        title: "LEGO 21006 The White House Model",
        price: 40,
        sold: true,
        closed: true,
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([item], "21006");
      expect(parsed.lots.length).toBe(1);
      expect(parsed.lots[0].condition).not.toBe("USED_COMPLETE");
      expect(parsed.lots[0].condition).toBe("UNKNOWN");
    });
  });

  describe("3. Shipping Cost Truthfulness (Eliminate Invented 15.0 Default)", () => {
    test("Shipping cost is undefined / null when no shipping rate is available", () => {
      const item: RawApifyLotItem = {
        id: 106072545,
        title: "LEGO Set - 21006 - Architecture - The White House",
        currentBidEUR: 36,
        sold: true,
        closed: true,
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([item], "21006");
      expect(parsed.lots.length).toBe(1);
      expect(parsed.lots[0].shippingCost).toBeUndefined();
    });

    test("Parses genuine shipping rate from shippingRates table", () => {
      const item: RawApifyLotItem = {
        id: 105076768,
        title: "LEGO Set - 21036 - Architecture - Arc de Triomphe",
        currentBidEUR: 67,
        sold: true,
        closed: true,
        shippingRates: [
          { region: "France", regionCode: "fr", price: 11, currency: "EUR" },
          { region: "Rest of European Union", regionCode: "europe", price: 19.79, currency: "EUR" },
        ],
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([item], "21036");
      expect(parsed.lots.length).toBe(1);
      expect(parsed.lots[0].shippingCost).toBe(11);
    });
  });

  describe("4. Valuation Eligibility Gate (Real Completed Sale or No Valuation Evidence)", () => {
    test("Rejects CURRENT_BID, starting bid, or active auctions from valuation", () => {
      const activeBid = {
        price: 50,
        priceType: "CURRENT_BID",
        provenance: "LIVE_SCRAPE",
        seller: "GenuineSeller",
        externalUrl: "https://www.catawiki.com/en/l/123-lego-21006",
      };

      expect(isValuationEligibleEvidence(activeBid)).toBe(false);
    });

    test("Accepts SOLD_PRICE completed sale as valuation eligible", () => {
      const completedSale = {
        price: 36,
        priceType: "SOLD_PRICE",
        provenance: "LIVE_SCRAPE",
        seller: "GenuineSeller",
        externalUrl: "https://www.catawiki.com/en/l/106072545-lego-set-21006-architecture-the-white-house",
      };

      expect(isValuationEligibleEvidence(completedSale)).toBe(true);
    });

    test("PriceEngine strictly requires >= 2 completed sales; 1 sale is INSUFFICIENT", () => {
      const singleSale = [36];
      const metrics = PriceEngineService.calculateMetrics(singleSale, [new Date()], ["SOLD_PRICE"]);
      expect(metrics.confidenceTier).toBe("INSUFFICIENT");
      expect(metrics.confidenceScore).toBe(0);
      expect(metrics.sampleSize).toBe(1);
    });

    test("PriceEngine accurately calculates median for 2 completed sales", () => {
      // 21006 real completed sales: 35 EUR and 36 EUR
      const completedSales = [35, 36];
      const dates = [new Date("2026-08-31"), new Date("2026-08-24")];
      const metrics = PriceEngineService.calculateMetrics(completedSales, dates, ["SOLD_PRICE", "SOLD_PRICE"]);
      expect(metrics.median).toBe(35.5);
      expect(metrics.min).toBe(35);
      expect(metrics.max).toBe(36);
      expect(metrics.sampleSize).toBe(2);
    });
  });
});
