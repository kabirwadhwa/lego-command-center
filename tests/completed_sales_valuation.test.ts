import { PriceType } from "@prisma/client";
import {
  CatawikiScraperService,
  RawApifyLotItem,
  isCompletedLot,
  extractCompletedSalePrice,
  extractActiveAuctionBid,
} from "@/services/scraper/catawikiScraper";
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

  describe("5. Dedicated Normalizers: extractCompletedSalePrice vs extractActiveAuctionBid", () => {
    test("extractCompletedSalePrice extracts winning bid for closed & sold lot", () => {
      const lot: RawApifyLotItem = {
        id: 104874135,
        title: "LEGO Set - 75192 - Star Wars - New Sealed UCS Falcon",
        sold: true,
        closed: true,
        status: "closed",
        closeStatus: "Closed",
        currentBidEUR: 700,
        bidHistory: [{ amount: 700 }],
      };

      expect(isCompletedLot(lot)).toBe(true);
      expect(extractCompletedSalePrice(lot)).toBe(700);
      expect(extractActiveAuctionBid(lot)).toBeNull();
    });

    test("extractActiveAuctionBid extracts current bid for open/active auction and extractCompletedSalePrice returns null", () => {
      const activeLot: RawApifyLotItem = {
        id: 106751820,
        title: "Lego Set - 10281 - Creator Expert - Bonsai Tree",
        sold: false,
        closed: false,
        status: "closes_today",
        closeStatus: "Open",
        currentBidEUR: 32,
      };

      expect(isCompletedLot(activeLot)).toBe(false);
      expect(extractCompletedSalePrice(activeLot)).toBeNull();
      expect(extractActiveAuctionBid(activeLot)).toBe(32);
    });

    test("Closed lot without sale (unsold/reserve not met) is rejected from completed sales", () => {
      const unsoldLot: RawApifyLotItem = {
        id: 999999,
        title: "LEGO Set 75192 Star Wars Falcon",
        sold: false,
        closed: true,
        status: "closed",
        closeStatus: "Closed",
        currentBidEUR: 400,
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([unsoldLot], "75192");
      expect(parsed.acceptedCount).toBe(0);
      expect(parsed.rejectedCount).toBe(1);
      expect(parsed.rejectionReasonCounts.NOT_COMPLETED_SALE).toBe(1);
    });
  });

  describe("6. Real 75192 Raw Catawiki Lots Parsing", () => {
    test("Parses real 75192 completed lots 104874135 (€700) and 105325498 (€490) as SOLD_PRICE", () => {
      const lot700: RawApifyLotItem = {
        id: 104874135,
        title: "LEGO - Set - 75192 - Star Wars - New Sealed UCS Falcon - 2017-present",
        url: "https://www.catawiki.com/en/l/104874135-lego-set-75192-star-wars-new-sealed-ucs-falcon",
        sold: true,
        closed: true,
        status: "closed",
        closeStatus: "Closed",
        currentBidEUR: 700,
        bidHistory: [{ amount: 700 }],
        specs: {
          Condition: "Unused",
          Packaging: "in undamaged sealed original box",
          "Complete set": "Yes",
          "Serial number": "75192",
        },
        shippingRates: [{ region: "Germany", price: 7.5, currency: "EUR" }],
      };

      const lot490: RawApifyLotItem = {
        id: 105325498,
        title: "LEGO Set - 75192 - Star Wars - MILLENIUM FALCON - UCS",
        url: "https://www.catawiki.com/en/l/105325498-lego-set-75192-star-wars-millenium-falcon-ucs",
        sold: true,
        closed: true,
        status: "closed",
        closeStatus: "Closed",
        currentBidEUR: 490,
        bidHistory: [{ amount: 490 }],
        specs: {
          Condition: "Used",
          Packaging: "with manual in opened box",
          "Complete set": "Yes",
          "Serial number": "75192",
        },
        shippingRates: [{ region: "Germany", price: 35, currency: "EUR" }],
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([lot700, lot490], "75192");
      expect(parsed.acceptedCount).toBe(2);
      expect(parsed.completedLotsDetected).toBe(2);
      expect(parsed.finalPricesExtracted).toBe(2);

      const [p1, p2] = parsed.lots;
      expect(p1.price).toBe(700);
      expect(p1.priceType).toBe(PriceType.SOLD_PRICE);
      expect(p1.condition).toBe("NEW_SEALED");
      expect(p1.shippingCost).toBe(7.5);
      expect(isValuationEligibleEvidence(p1)).toBe(true);

      expect(p2.price).toBe(490);
      expect(p2.priceType).toBe(PriceType.SOLD_PRICE);
      expect(p2.condition).toBe("USED_COMPLETE");
      expect(p2.shippingCost).toBe(35);
      expect(isValuationEligibleEvidence(p2)).toBe(true);

      // Price engine calculation on these two real completed sales:
      const metrics = PriceEngineService.calculateMetrics([p1.price, p2.price], [p1.capturedAt, p2.capturedAt], [p1.priceType, p2.priceType]);
      expect(metrics.median).toBe(595);
      expect(metrics.min).toBe(490);
      expect(metrics.max).toBe(700);
      expect(metrics.confidenceTier).toBe("LOW");
    });

    test("Deduplicates lot IDs across different language locales (e.g. /en/l/ vs /es/l/)", () => {
      const lotEn: RawApifyLotItem = {
        id: 104874135,
        title: "LEGO Set - 75192 - Star Wars - UCS Millennium Falcon",
        url: "https://www.catawiki.com/en/l/104874135",
        sold: true,
        closed: true,
        currentBidEUR: 700,
      };

      const lotEs: RawApifyLotItem = {
        id: 104874135,
        title: "Lego Set - 75192 - Star Wars - Halcón Milenario UCS",
        url: "https://www.catawiki.com/es/l/104874135",
        sold: true,
        closed: true,
        currentBidEUR: 700,
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry([lotEn, lotEs], "75192");
      expect(parsed.acceptedCount).toBe(1);
      expect(parsed.rejectedCount).toBe(1);
      expect(parsed.rejectionReasonCounts.DUPLICATE).toBe(1);
    });
  });
});
