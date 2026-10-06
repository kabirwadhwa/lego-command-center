import {
  BrickLinkProvider,
  generateBrickLinkObservationFingerprint,
} from "../src/services/pricing/providers/bricklinkProvider";
import {
  BrickLinkClient,
  mapToBrickLinkItem,
  parseStrictPrice,
  parseStrictInteger,
} from "../src/services/bricklink/bricklinkClient";
import { ResolvedLegoProduct } from "../src/services/catalog/productIdentificationService";

describe("BrickLink Provider & Official API Client Unit Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("mapToBrickLinkItem", () => {
    it("maps LEGO_SET canonical '10316' to '10316-1'", () => {
      const mapped = mapToBrickLinkItem("10316", "LEGO_SET");
      expect(mapped.itemNo).toBe("10316-1");
      expect(mapped.itemType).toBe("SET");
    });

    it("preserves already-suffixed set numbers like '10316-2'", () => {
      const mapped = mapToBrickLinkItem("10316-2", "LEGO_SET");
      expect(mapped.itemNo).toBe("10316-2");
      expect(mapped.itemType).toBe("SET");
    });

    it("maps LEGO_PART canonical '35106' to '35106' without appending -1", () => {
      const mapped = mapToBrickLinkItem("35106", "LEGO_PART");
      expect(mapped.itemNo).toBe("35106");
      expect(mapped.itemType).toBe("PART");
    });

    it("strips accidental trailing variant from LEGO_PART canonical '35106-1'", () => {
      const mapped = mapToBrickLinkItem("35106-1", "LEGO_PART");
      expect(mapped.itemNo).toBe("35106");
      expect(mapped.itemType).toBe("PART");
    });
  });

  describe("parseStrictPrice & parseStrictInteger", () => {
    it("parses valid floating point and string numbers", () => {
      expect(parseStrictPrice("349.99")).toBe(349.99);
      expect(parseStrictPrice(350)).toBe(350);
      expect(parseStrictPrice("0")).toBe(0);
    });

    it("strictly returns null for invalid, NaN, negative, or empty prices", () => {
      expect(parseStrictPrice("NaN")).toBeNull();
      expect(parseStrictPrice("invalid")).toBeNull();
      expect(parseStrictPrice("-15.00")).toBeNull();
      expect(parseStrictPrice("")).toBeNull();
      expect(parseStrictPrice(null)).toBeNull();
      expect(parseStrictPrice(undefined)).toBeNull();
    });

    it("parses integer quantities strictly", () => {
      expect(parseStrictInteger("5")).toBe(5);
      expect(parseStrictInteger(12)).toBe(12);
      expect(parseStrictInteger("invalid")).toBe(0);
      expect(parseStrictInteger(null)).toBe(0);
    });
  });

  describe("Configuration Truthfulness", () => {
    it("returns false for isOfficialOAuthConfigured() when any of the 4 secrets are missing", () => {
      delete process.env.BRICKLINK_CONSUMER_KEY;
      delete process.env.BRICKLINK_CONSUMER_SECRET;
      delete process.env.BRICKLINK_TOKEN_VALUE;
      delete process.env.BRICKLINK_TOKEN_SECRET;

      const provider = new BrickLinkProvider();
      expect(provider.isOfficialOAuthConfigured()).toBe(false);
      expect(provider.getMissingCredentials()).toEqual([
        "BRICKLINK_CONSUMER_KEY",
        "BRICKLINK_CONSUMER_SECRET",
        "BRICKLINK_TOKEN_VALUE",
        "BRICKLINK_TOKEN_SECRET",
      ]);
    });

    it("returns NOT_CONFIGURED when searchMarket is invoked with BRICKLINK_DISABLED=true", async () => {
      process.env.BRICKLINK_DISABLED = "true";

      const provider = new BrickLinkProvider();
      expect(provider.isConfigured()).toBe(false);

      const product: ResolvedLegoProduct = {
        input: "10316",
        identifierType: "LEGO_SET",
        canonicalIdentifier: "10316",
        name: "Rivendell",
        theme: "The Lord of the Rings",
        year: 2023,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: 1.0,
      };

      const result = await provider.searchMarket(product);
      expect(result.status).toBe("NOT_CONFIGURED");
      expect(result.evidence).toHaveLength(0);
      expect(result.error).toContain("explicitly disabled");

      delete process.env.BRICKLINK_DISABLED;
    });
  });

  describe("Fingerprinting & Deduplication", () => {
    it("generates deterministic identical fingerprint for identical sales", () => {
      const date = new Date("2026-05-12T14:32:00.000Z");
      const fp1 = generateBrickLinkObservationFingerprint({
        itemType: "SET",
        itemNo: "10316-1",
        guideType: "sold",
        condition: "N",
        unitPrice: 349.99,
        quantity: 1,
        dateOrdered: date,
        sellerCountryCode: "DE",
        buyerCountryCode: "FR",
      });

      const fp2 = generateBrickLinkObservationFingerprint({
        itemType: "SET",
        itemNo: "10316-1",
        guideType: "sold",
        condition: "N",
        unitPrice: 349.99,
        quantity: 1,
        dateOrdered: date,
        sellerCountryCode: "DE",
        buyerCountryCode: "FR",
      });

      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(24);
    });

    it("generates distinct fingerprints for different unit prices or order dates", () => {
      const fp1 = generateBrickLinkObservationFingerprint({
        itemType: "SET",
        itemNo: "10316-1",
        guideType: "sold",
        condition: "N",
        unitPrice: 349.99,
        quantity: 1,
        dateOrdered: new Date("2026-05-12T14:32:00.000Z"),
      });

      const fp2 = generateBrickLinkObservationFingerprint({
        itemType: "SET",
        itemNo: "10316-1",
        guideType: "sold",
        condition: "N",
        unitPrice: 380.00,
        quantity: 1,
        dateOrdered: new Date("2026-05-12T14:32:00.000Z"),
      });

      expect(fp1).not.toBe(fp2);
    });

    it("ensures repeated identical API refreshes produce identical fingerprints preventing DB duplication", () => {
      const orders = [
        { unitPrice: 340.0, quantity: 1, dateOrdered: new Date("2026-05-10T10:00:00.000Z"), sellerCountryCode: "DE", buyerCountryCode: "FR" },
        { unitPrice: 360.0, quantity: 1, dateOrdered: new Date("2026-05-15T12:00:00.000Z"), sellerCountryCode: "NL", buyerCountryCode: "BE" },
      ];

      // Refresh 1
      const refresh1Fingerprints = orders.map((o) =>
        generateBrickLinkObservationFingerprint({
          itemType: "SET",
          itemNo: "10316-1",
          guideType: "sold",
          condition: "N",
          unitPrice: o.unitPrice,
          quantity: o.quantity,
          dateOrdered: o.dateOrdered,
          sellerCountryCode: o.sellerCountryCode,
          buyerCountryCode: o.buyerCountryCode,
        })
      );

      // Refresh 2 (e.g. 6 hours later)
      const refresh2Fingerprints = orders.map((o) =>
        generateBrickLinkObservationFingerprint({
          itemType: "SET",
          itemNo: "10316-1",
          guideType: "sold",
          condition: "N",
          unitPrice: o.unitPrice,
          quantity: o.quantity,
          dateOrdered: o.dateOrdered,
          sellerCountryCode: o.sellerCountryCode,
          buyerCountryCode: o.buyerCountryCode,
        })
      );

      expect(refresh1Fingerprints).toEqual(refresh2Fingerprints);
      expect(new Set(refresh1Fingerprints).size).toBe(2);
    });
  });

  describe("searchMarket with Mocked BrickLinkClient", () => {
    let mockClient: jest.Mocked<BrickLinkClient>;

    beforeEach(() => {
      mockClient = {
        isConfigured: jest.fn().mockReturnValue(true),
        getMissingCredentials: jest.fn().mockReturnValue([]),
        getCatalogItem: jest.fn(),
        getPriceGuide: jest.fn(),
        testConnection: jest.fn(),
      } as unknown as jest.Mocked<BrickLinkClient>;
    });

    it("truthfully rejects UNKNOWN identifier without calling catalog or price guide", async () => {
      const provider = new BrickLinkProvider(mockClient);
      const unknownProduct: ResolvedLegoProduct = {
        input: "random_unknown_sku",
        identifierType: "UNKNOWN",
        canonicalIdentifier: "",
        name: null,
        theme: null,
        year: null,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: null,
      };

      const result = await provider.searchMarket(unknownProduct);
      expect(result.status).toBe("NO_MATCHES");
      expect(result.diagnosticStatus).toBe("UNSUPPORTED_IDENTIFIER");
      expect(mockClient.getCatalogItem).not.toHaveBeenCalled();
      expect(mockClient.getPriceGuide).not.toHaveBeenCalled();
    });

    it("returns NO_MATCHES when catalog item does not exist (404)", async () => {
      mockClient.getCatalogItem.mockResolvedValue(null);

      const provider = new BrickLinkProvider(mockClient);
      const product: ResolvedLegoProduct = {
        input: "999999",
        identifierType: "LEGO_SET",
        canonicalIdentifier: "999999",
        name: "Nonexistent Set",
        theme: "General",
        year: null,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: 0.9,
      };

      const result = await provider.searchMarket(product);
      expect(result.status).toBe("NO_MATCHES");
      expect(result.diagnosticStatus).toBe("ITEM_NOT_FOUND");
      expect(mockClient.getCatalogItem).toHaveBeenCalledWith("SET", "999999-1");
      expect(mockClient.getPriceGuide).not.toHaveBeenCalled();
    });

    it("parses SOLD and STOCK price guides with strict VAT, condition, and seller truthfulness", async () => {
      mockClient.getCatalogItem.mockResolvedValue({
        no: "10316-1",
        name: "The Lord of the Rings: Rivendell",
        type: "SET",
        yearReleased: 2023,
      });

      // Mock the 4 price guide modes
      mockClient.getPriceGuide.mockImplementation(async (params) => {
        if (params.guideType === "sold" && params.condition === "N") {
          return {
            summary: {
              itemNo: "10316-1",
              itemType: "SET",
              guideType: "sold",
              condition: "N",
              currencyCode: "EUR",
              minPrice: 310.0,
              maxPrice: 410.0,
              avgPrice: 356.12,
              qtyAvgPrice: 348.5,
              unitQuantity: 2,
              totalQuantity: 2,
              vatIncluded: false,
              priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
            },
            priceDetails: [
              {
                quantity: 1,
                unitPrice: 340.0,
                sellerCountryCode: "DE",
                buyerCountryCode: "FR",
                dateOrdered: new Date("2026-05-10T10:00:00.000Z"),
              },
              {
                quantity: 1,
                unitPrice: 360.0,
                sellerCountryCode: "NL",
                buyerCountryCode: "BE",
                dateOrdered: new Date("2026-05-15T12:00:00.000Z"),
              },
            ],
          };
        }

        if (params.guideType === "stock" && params.condition === "N") {
          return {
            summary: {
              itemNo: "10316-1",
              itemType: "SET",
              guideType: "stock",
              condition: "N",
              currencyCode: "EUR",
              minPrice: 365.0,
              maxPrice: 450.0,
              avgPrice: 399.0,
              qtyAvgPrice: 395.0,
              unitQuantity: 1,
              totalQuantity: 1,
              vatIncluded: false,
              priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
            },
            priceDetails: [
              {
                quantity: 1,
                unitPrice: 375.0,
                sellerCountryCode: "DE",
                buyerCountryCode: null,
                dateOrdered: null,
              },
            ],
          };
        }

        // sold U and stock U return empty
        return {
          summary: {
            itemNo: "10316-1",
            itemType: "SET",
            guideType: params.guideType,
            condition: params.condition,
            currencyCode: "EUR",
            minPrice: null,
            maxPrice: null,
            avgPrice: null,
            qtyAvgPrice: null,
            unitQuantity: 0,
            totalQuantity: 0,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
          },
          priceDetails: [],
        };
      });

      const provider = new BrickLinkProvider(mockClient);
      const product: ResolvedLegoProduct = {
        input: "10316",
        identifierType: "LEGO_SET",
        canonicalIdentifier: "10316",
        name: "Rivendell",
        theme: "The Lord of the Rings",
        year: 2023,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: 1.0,
      };

      const result = await provider.searchMarket(product);
      expect(result.status).toBe("SUCCESS");
      expect(result.diagnosticStatus).toBe("LIVE_SUCCESS");
      expect(result.evidence).toHaveLength(3); // 2 sold + 1 stock

      const soldEvidence = result.evidence.filter((e) => e.saleType === "SOLD");
      const stockEvidence = result.evidence.filter((e) => e.saleType === "ACTIVE_LISTING");

      expect(soldEvidence).toHaveLength(2);
      expect(stockEvidence).toHaveLength(1);

      // Verify SOLD evidence properties
      const s0 = soldEvidence[0];
      expect(s0.provider).toBe("bricklink");
      expect(s0.marketplace).toBe("BRICKLINK");
      expect(s0.price).toBe(340.0);
      expect(s0.currency).toBe("EUR");
      expect(s0.seller).toBeNull(); // Strict rule: never "BrickLink Verified Order"
      expect(s0.condition).toBe("NEW_SEALED");
      expect(s0.provenance).toBe("LIVE_API");
      expect(s0.externalUrl).toContain("https://www.bricklink.com/v2/catalog/catalogitem.page?S=10316-1#sale=");
      expect(s0.rawMetadata?.vatIncluded).toBe(false);
      expect(s0.rawMetadata?.priceBasis).toBe("EX_VAT_BRICKLINK_PRICE_GUIDE");
      expect(s0.rawMetadata?.sellerCountryCode).toBe("DE");
      expect(s0.rawMetadata?.buyerCountryCode).toBe("FR");

      // Verify STOCK evidence properties
      const k0 = stockEvidence[0];
      expect(k0.saleType).toBe("ACTIVE_LISTING");
      expect(k0.price).toBe(375.0);
      expect(k0.condition).toBe("NEW_SEALED");
      expect(k0.provenance).toBe("LIVE_API");

      // Verify Aggregate statistics preservation in telemetry
      const aggregates = result.telemetry?.aggregates as Record<string, unknown>;
      expect(aggregates).toBeDefined();
      expect(aggregates.soldNew).toEqual({
        min: 310.0,
        avg: 356.12,
        qtyAvg: 348.5,
        max: 410.0,
        unitQty: 2,
        totalQty: 2,
        detailCount: 2,
      });
      expect(aggregates.stockNew).toEqual({
        min: 365.0,
        avg: 399.0,
        qtyAvg: 395.0,
        max: 450.0,
        unitQty: 1,
        totalQty: 1,
        detailCount: 1,
      });
    });

    it("accurately reports AUTH_FAILED when API returns HTTP 401", async () => {
      mockClient.getCatalogItem.mockRejectedValue(
        new Error("BrickLink authentication failed (HTTP 401). Verify OAuth 1.0 credentials.")
      );

      const provider = new BrickLinkProvider(mockClient);
      const product: ResolvedLegoProduct = {
        input: "10316",
        identifierType: "LEGO_SET",
        canonicalIdentifier: "10316",
        name: "Rivendell",
        theme: "The Lord of the Rings",
        year: 2023,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: 1.0,
      };

      const result = await provider.searchMarket(product);
      expect(result.status).toBe("FAILED");
      expect(result.diagnosticStatus).toBe("AUTH_FAILED");
      expect(result.error).toContain("HTTP 401");
    });
  });
});
