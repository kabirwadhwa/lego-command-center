import {
  CatawikiScraperService,
  buildCatawikiSearchQueries,
  parseCatawikiPrice,
  RawApifyLotItem,
} from "@/services/scraper/catawikiScraper";
import { PriceType } from "@prisma/client";

describe("Catawiki Scraper Telemetry, Query Construction & Rejection Tracking", () => {
  describe("1. Search Query Construction", () => {
    it("Constructs intelligent queries for a LEGO Set", () => {
      const queries = buildCatawikiSearchQueries("10316", {
        name: "The Lord of the Rings Rivendell",
        identifierType: "LEGO_SET",
      });
      expect(queries).toContain("LEGO 10316");
      expect(queries.some(q => q.includes("Rivendell"))).toBe(true);
    });

    it("Constructs intelligent queries for a LEGO Part", () => {
      const queries = buildCatawikiSearchQueries("35106", {
        name: "Aircraft Fuselage",
        identifierType: "LEGO_PART",
      });
      expect(queries).toContain("LEGO 35106");
      expect(queries).toContain("LEGO part 35106");
    });

    it("Constructs fallback queries when product metadata is unavailable", () => {
      const queries = buildCatawikiSearchQueries("99999", {
        name: "Product metadata unavailable",
        identifierType: "UNKNOWN",
      });
      expect(queries).toEqual(["LEGO 99999"]);
    });
  });

  describe("2. Robust Price Parser", () => {
    it("Parses standard, European comma, and thousands-separated prices", () => {
      expect(parseCatawikiPrice(150)).toBe(150);
      expect(parseCatawikiPrice("149.99")).toBe(149.99);
      expect(parseCatawikiPrice("149,50")).toBe(149.50);
      expect(parseCatawikiPrice("€ 1.250,00")).toBe(1250.00);
      expect(parseCatawikiPrice("£85.00")).toBe(85.00);
      expect(parseCatawikiPrice("invalid")).toBe(0);
    });
  });

  describe("3. Dataset Parsing & Rejection Tracking", () => {
    const mockItems: RawApifyLotItem[] = [
      // Valid item: Rivendell EUR 450
      {
        id: "cw-101",
        title: "LEGO Icons 10316 Rivendell New In Box",
        price: 450,
        currency: "EUR",
        url: "https://www.catawiki.com/en/l/101-lego-10316-rivendell",
        status: "bidding_open",
      },
      // Valid sold item with GBP converted to EUR
      {
        id: "cw-102",
        title: "LEGO Set 10316 Rivendell Complete",
        sold_price: 340,
        currency: "GBP",
        url: "https://www.catawiki.com/en/l/102-lego-10316-sold",
        is_closed: true,
      },
      // Rejected: IDENTIFIER_MISMATCH (wrong set number 75192)
      {
        id: "cw-103",
        title: "LEGO Star Wars 75192 Millennium Falcon",
        price: 650,
        currency: "EUR",
        url: "https://www.catawiki.com/en/l/103-lego-75192",
      },
      // Rejected: INVALID_PRICE (0 or negative)
      {
        id: "cw-104",
        title: "LEGO 10316 Rivendell Empty Box",
        price: 0,
        currency: "EUR",
        url: "https://www.catawiki.com/en/l/104-lego-10316",
      },
      // Rejected: CURRENCY_UNSUPPORTED (e.g. JPY)
      {
        id: "cw-105",
        title: "LEGO 10316 Rivendell Special Edition",
        price: 500,
        currency: "JPY",
        url: "https://www.catawiki.com/en/l/105-lego-10316",
      },
      // Rejected: MISSING_REQUIRED_DATA (empty title)
      {
        id: "cw-106",
        title: "",
        price: 300,
        currency: "EUR",
        url: "https://www.catawiki.com/en/l/106-lego-10316",
      },
      // Rejected: DUPLICATE
      {
        id: "cw-101",
        title: "LEGO Icons 10316 Rivendell New In Box",
        price: 450,
        currency: "EUR",
        url: "https://www.catawiki.com/en/l/101-lego-10316-rivendell",
      },
    ];

    it("Accurately counts raw vs accepted vs rejected items and records exact rejection reasons", () => {
      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry(mockItems, "10316", "Rivendell");

      expect(parsed.acceptedCount).toBe(2);
      expect(parsed.rejectedCount).toBe(5);
      expect(parsed.lots.length).toBe(2);

      expect(parsed.rejectionReasonCounts.IDENTIFIER_MISMATCH).toBe(1);
      expect(parsed.rejectionReasonCounts.INVALID_PRICE).toBe(1);
      expect(parsed.rejectionReasonCounts.CURRENCY_UNSUPPORTED).toBe(1);
      expect(parsed.rejectionReasonCounts.MISSING_REQUIRED_DATA).toBe(1);
      expect(parsed.rejectionReasonCounts.DUPLICATE).toBe(1);

      // Verify accepted lots details
      const lot1 = parsed.lots.find(l => l.externalListingId === "cw-101")!;
      expect(lot1).toBeDefined();
      expect(lot1.price).toBe(450);
      expect(lot1.priceType).toBe(PriceType.CURRENT_BID);
      expect(lot1.externalUrl).toBe("https://www.catawiki.com/en/l/101-lego-10316-rivendell");

      // GBP 340 converted to EUR (340 / 0.85 = 400 EUR)
      const lot2 = parsed.lots.find(l => l.externalListingId === "cw-102")!;
      expect(lot2).toBeDefined();
      expect(lot2.price).toBe(400);
      expect(lot2.priceType).toBe(PriceType.SOLD_PRICE);
    });

    it("Parses solidcode actor output with currentBidValue, sellerShopName, and proper attribution", () => {
      const solidCodeItem: RawApifyLotItem = {
        id: 106849337,
        title: "LEGO Set - 42115 - Technic - Lamborghini Sián FKP 37",
        subtitle: "Mint - in sealed box",
        url: "https://www.catawiki.com/en/l/106849337-lego-set-42115-technic-lamborghini-sian-fkp-37",
        currentBid: { EUR: 200, USD: 231, GBP: 171 },
        currentBidValue: 200,
        currentBidCurrency: "EUR",
        sellerShopName: "Best_Seller_Ever!",
        biddingEndTime: "2026-09-29T19:09:40Z",
        closeStatus: "open",
      };

      const parsed = CatawikiScraperService.parseApifyDatasetWithTelemetry(
        [solidCodeItem],
        "42115",
        "Lamborghini Sian",
        "solidcode~catawiki-scraper"
      );

      expect(parsed.acceptedCount).toBe(1);
      expect(parsed.rejectedCount).toBe(0);
      expect(parsed.lots.length).toBe(1);

      const lot = parsed.lots[0];
      expect(lot.price).toBe(200);
      expect(lot.currency).toBe("EUR");
      expect(lot.priceType).toBe(PriceType.CURRENT_BID);
      expect(lot.condition).toBe("NEW_SEALED");
      expect(lot.seller).toBe("Best_Seller_Ever!");
      expect(lot.provider).toBe("apify/solidcode/catawiki-scraper");
      expect(lot.externalUrl).toBe("https://www.catawiki.com/en/l/106849337-lego-set-42115-technic-lamborghini-sian-fkp-37");
    });
  });

  describe("4. Scraper Runtime Status Handling", () => {
    it("Reports NOT_CONFIGURED when APIFY_API_TOKEN is missing", async () => {
      const origToken = process.env.APIFY_API_TOKEN;
      delete process.env.APIFY_API_TOKEN;

      try {
        const { lots, telemetry } = await CatawikiScraperService.fetchMarketObservationsWithTelemetry({
          identifier: "10316",
        });

        expect(lots).toEqual([]);
        expect(telemetry.configured).toBe(false);
        expect(telemetry.status).toBe("NOT_CONFIGURED");
        expect(telemetry.errorMessage).toContain("APIFY_API_TOKEN");
      } finally {
        if (origToken) process.env.APIFY_API_TOKEN = origToken;
      }
    });
  });
});
