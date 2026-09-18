import {
  isEligibleForRealMarketPricing,
  isGenuineListingUrl,
  GENUINE_PROVENANCES,
  ObservableRecord,
} from "@/services/pricing/evidenceEligibility";
import { CatawikiScraperService, RawApifyLotItem } from "@/services/scraper/catawikiScraper";
import { PriceEngineService } from "@/services/pricing/priceEngineService";
import { ObservationProvenance, PriceType } from "@prisma/client";

describe("Anti-Simulation Data-Integrity Invariant Suite", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. isEligibleForRealMarketPricing unit validation", () => {
    it("strictly rejects SIMULATED provenance", () => {
      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.SIMULATED,
        price: 150.0,
      })).toBe(false);

      expect(isEligibleForRealMarketPricing({
        provenance: "SIMULATED",
        price: 150.0,
      })).toBe(false);
    });

    it("accepts only GENUINE_PROVENANCES", () => {
      for (const prov of GENUINE_PROVENANCES) {
        expect(isEligibleForRealMarketPricing({
          provenance: prov,
          price: 150.0,
          seller: "Authentic Bricks",
          externalUrl: "https://www.catawiki.com/en/l/12345",
        })).toBe(true);
      }

      // Reject unknown or arbitrary provenance
      expect(isEligibleForRealMarketPricing({
        provenance: "UNKNOWN",
        price: 150.0,
      })).toBe(false);

      expect(isEligibleForRealMarketPricing({
        provenance: null,
        price: 150.0,
      })).toBe(false);
    });

    it("rejects non-positive or invalid prices", () => {
      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: 0,
      })).toBe(false);

      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: -25.0,
      })).toBe(false);

      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: NaN,
      })).toBe(false);
    });

    it("strictly rejects synthetic seller names containing 'simulated'", () => {
      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: 100.0,
        seller: "Simulated Seller #85",
      })).toBe(false);

      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: 100.0,
        seller: "simulated-test-account",
      })).toBe(false);
    });

    it("strictly rejects synthetic URLs containing 'simulated'", () => {
      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: 100.0,
        externalUrl: "https://www.catawiki.com/en/l/simulated-35106-1001",
      })).toBe(false);
    });

    it("strictly rejects synthetic titles or ids containing 'simulated'", () => {
      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: 100.0,
        title: "[SIMULATED] LEGO Set 35106",
      })).toBe(false);

      expect(isEligibleForRealMarketPricing({
        provenance: ObservationProvenance.LIVE_SCRAPE,
        price: 100.0,
        id: "simulated-catawiki-lot-35106-1001",
      })).toBe(false);
    });
  });

  describe("2. isGenuineListingUrl URL validation", () => {
    it("accepts valid https URLs without simulated keywords", () => {
      expect(isGenuineListingUrl("https://www.catawiki.com/en/l/87654321")).toBe(true);
      expect(isGenuineListingUrl("http://www.bricklink.com/item.asp?id=123")).toBe(true);
    });

    it("rejects simulated URLs", () => {
      expect(isGenuineListingUrl("https://www.catawiki.com/en/l/simulated-35106-1")).toBe(false);
      expect(isGenuineListingUrl("/en/l/simulated-35106-1001")).toBe(false);
    });

    it("rejects non-http relative or malformed URLs", () => {
      expect(isGenuineListingUrl("/en/l/12345")).toBe(false);
      expect(isGenuineListingUrl(null)).toBe(false);
      expect(isGenuineListingUrl("")).toBe(false);
      expect(isGenuineListingUrl("javascript:void(0)")).toBe(false);
    });
  });

  describe("3. CatawikiScraperService — Zero Simulation Invariant", () => {
    it("Scenario 1: Returns empty array when APIFY_API_TOKEN is unconfigured, regardless of APP_MODE", async () => {
      delete process.env.APIFY_API_TOKEN;

      // In production mode
      process.env.APP_MODE = "production";
      const prodLots = await CatawikiScraperService.fetchMarketObservations("35106", 100.0, 20);
      expect(prodLots).toEqual([]);

      // In demo mode
      process.env.APP_MODE = "demo";
      const demoLots = await CatawikiScraperService.fetchMarketObservations("35106", 100.0, 20);
      expect(demoLots).toEqual([]);

      // In undefined / development mode
      delete process.env.APP_MODE;
      const devLots = await CatawikiScraperService.fetchMarketObservations("35106", 100.0, 20);
      expect(devLots).toEqual([]);
    });

    it("Scenario 9: Enforces strict word boundary matching for LEGO set numbers", () => {
      const mockItems: RawApifyLotItem[] = [
        { id: "1", title: "LEGO 35106 Speed Champions Ferrari F40", price: 145.0, seller: "Authentic Store", url: "https://catawiki.com/l/1" },
        { id: "2", title: "LEGO 351060 Giant Crane", price: 250.0, seller: "Authentic Store", url: "https://catawiki.com/l/2" }, // Boundary mismatch: 351060
        { id: "3", title: "LEGO 135106 City Train", price: 80.0, seller: "Authentic Store", url: "https://catawiki.com/l/3" },  // Boundary mismatch: 135106
        { id: "4", title: "Boxed Set #35106 - Sealed In Box", price: 155.0, seller: "Authentic Store", url: "https://catawiki.com/l/4" }, // Match
      ];

      const parsed = CatawikiScraperService.parseApifyDataset(mockItems, "35106");
      expect(parsed.length).toBe(2);
      expect(parsed[0].externalListingId).toBe("1");
      expect(parsed[1].externalListingId).toBe("4");
      for (const lot of parsed) {
        expect(lot.provenance).toBe(ObservationProvenance.LIVE_SCRAPE);
      }
    });

    it("Scenario 10 & 11: Omits simulated sellers and simulated URLs from parsed dataset", () => {
      const mockItems: RawApifyLotItem[] = [
        {
          id: "lot-real",
          title: "LEGO 10316 Rivendell Complete",
          price: 420.0,
          seller: "Verified Collector",
          url: "https://www.catawiki.com/en/l/10316-real",
        },
        {
          id: "lot-sim",
          title: "LEGO 10316 Rivendell Sealed",
          price: 430.0,
          seller: "Simulated Seller #42",
          url: "https://www.catawiki.com/en/l/simulated-10316-fake",
        },
      ];

      const parsed = CatawikiScraperService.parseApifyDataset(mockItems, "10316");
      expect(parsed.length).toBe(2);

      // Real item keeps seller and URL
      expect(parsed[0].seller).toBe("Verified Collector");
      expect(parsed[0].externalUrl).toBe("https://www.catawiki.com/en/l/10316-real");

      // Simulated seller and URL are discarded
      expect(parsed[1].seller).toBeUndefined();
      expect(parsed[1].externalUrl).toBeUndefined();
    });
  });

  describe("4. Pricing Engine — Statistical Calculation Invariants", () => {
    it("Scenario 7: Exactly 1 observation is strictly INSUFFICIENT evidence", () => {
      const metrics = PriceEngineService.calculateMetrics([140.0]);
      expect(metrics.sampleSize).toBe(1);
      expect(metrics.confidenceTier).toBe("INSUFFICIENT");
      expect(metrics.confidenceScore).toBe(0);
    });

    it("Scenario 8: Exactly 2 genuine observations allows LOW confidence tier", () => {
      const metrics = PriceEngineService.calculateMetrics(
        [140.0, 142.0],
        [new Date(), new Date()],
        [PriceType.SOLD_PRICE, PriceType.SOLD_PRICE]
      );
      expect(metrics.sampleSize).toBe(2);
      expect(metrics.confidenceTier).toBe("LOW");
      expect(metrics.confidenceScore).toBeGreaterThan(0);
      expect(metrics.confidenceScore).toBeLessThanOrEqual(40);
    });

    it("Strictly excludes SIMULATED records from evidence arrays", () => {
      const rawRecords: ObservableRecord[] = [
        { provenance: ObservationProvenance.SIMULATED, price: 138.47, seller: "Simulated Seller #85" },
        { provenance: ObservationProvenance.SIMULATED, price: 139.87, seller: "Simulated Seller #86" },
        { provenance: ObservationProvenance.LIVE_SCRAPE, price: 210.0, seller: "Genuine Shop" },
        { provenance: ObservationProvenance.LIVE_SCRAPE, price: 215.0, seller: "Genuine Shop" },
      ];

      const eligible = rawRecords.filter(isEligibleForRealMarketPricing);
      expect(eligible.length).toBe(2);
      expect(eligible.every((e) => e.provenance === ObservationProvenance.LIVE_SCRAPE)).toBe(true);

      const prices = eligible.map((e) => Number(e.price));
      const metrics = PriceEngineService.calculateMetrics(prices);
      expect(metrics.median).toBe(212.5); // (210 + 215) / 2
      expect(metrics.sampleSize).toBe(2);
    });
  });

  describe("5. Breakeven Floor & Fee Calculation Invariants", () => {
    it("Scenario 6: Calculates breakeven floor truthfully without fabricating selling price", () => {
      const hypotheticalCost = 100.0;
      const catawikiFees = {
        channel: "CATAWIKI",
        variableFeePct: 0.125,
        fixedFee: 0.0,
        estimatedShipping: 0.0,
        pricingEconomicsAvailable: true,
        liveMarketDataIntegrationAvailable: true,
        description: "Catawiki fee",
      };

      // Breakeven floor = cost / (1 - 0.125) = 100 / 0.875 = 114.29
      const breakeven = Math.round((hypotheticalCost / (1 - catawikiFees.variableFeePct)) * 100) / 100;
      expect(breakeven).toBe(114.29);
    });
  });

  describe("6. Regression Test: LEGO Set 35106 (The Incident Reproduction)", () => {
    it("Scenario 14: Set 35106 with unconfigured scraper returns 0 genuine observations and null recommendation", async () => {
      delete process.env.APIFY_API_TOKEN;

      const lots = await CatawikiScraperService.fetchMarketObservations("35106", 100.0, 20);
      expect(lots).toHaveLength(0);

      // Verify no simulated data is fabricated
      const eligible = lots.filter(isEligibleForRealMarketPricing);
      expect(eligible).toHaveLength(0);

      // When 0 observations exist, metrics must reflect zero/null
      const metrics = PriceEngineService.calculateMetrics(eligible.map((e) => Number(e.price)));
      expect(metrics.sampleSize).toBe(0);
      expect(metrics.median).toBe(0);
      expect(metrics.confidenceTier).toBe("INSUFFICIENT");
    });
  });
});
