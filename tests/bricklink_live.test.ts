import { BrickLinkClient } from "../src/services/bricklink/bricklinkClient";
import { BrickLinkProvider } from "../src/services/pricing/providers/bricklinkProvider";
import { ResolvedLegoProduct } from "../src/services/catalog/productIdentificationService";

describe("BrickLink LIVE_EXTERNAL Official API Acceptance Test", () => {
  const client = new BrickLinkClient();
  const isConfigured = client.isConfigured();

  if (!isConfigured) {
    const missing = client.getMissingCredentials();
    test("BrickLink API credentials NOT_CONFIGURED - Skipping live external tests", () => {
      console.warn(
        `⚠️  Skipping BrickLink LIVE_EXTERNAL tests: credentials missing (${missing.join(", ")}).`
      );
      expect(isConfigured).toBe(false);
    });
    return;
  }

  // When credentials are configured, execute real network calls
  describe("Live Official API Connectivity (10316-1 Rivendell)", () => {
    const testItemNo = "10316-1";

    it("verifies OAuth 1.0 connection diagnostic succeeds against official API", async () => {
      const diag = await client.testConnection(testItemNo);

      console.log("\n--- BrickLink Live Diagnostic ---");
      console.log(`Status: ${diag.status}`);
      console.log(`Message: ${diag.message}`);
      console.log(`Item Checked: ${diag.itemChecked}`);
      console.log(`Detail Count: ${diag.detailCount}`);
      console.log(`Duration: ${diag.durationMs}ms`);

      expect(diag.status).toBe("SUCCESS");
      expect(diag.httpStatus).toBe(200);
      expect(diag.summary?.vatIncluded).toBe(false);
      expect(diag.summary?.priceBasis).toBe("EX_VAT_BRICKLINK_PRICE_GUIDE");
    }, 30000);

    it("resolves catalog item metadata for 10316-1 without errors", async () => {
      const item = await client.getCatalogItem("SET", testItemNo);

      expect(item).not.toBeNull();
      expect(item?.no).toBe(testItemNo);
      expect(item?.type).toBe("SET");
      expect(item?.name).toContain("Rivendell");

      console.log(`\nCatalog Item: ${item?.name} (${item?.no}), Released: ${item?.yearReleased}`);
    }, 20000);

    it("retrieves and strictly validates SOLD / NEW Price Guide", async () => {
      const result = await client.getPriceGuide({
        itemType: "SET",
        itemNo: testItemNo,
        guideType: "sold",
        condition: "N",
        currencyCode: "EUR",
      });

      expect(result).not.toBeNull();
      const summary = result!.summary;

      console.log("\n--- BRICKLINK — SET 10316-1 — SOLD — NEW (Last 6 Months) ---");
      console.log(`Currency: ${summary.currencyCode}`);
      console.log(`Low (min): €${summary.minPrice}`);
      console.log(`Average: €${summary.avgPrice}`);
      console.log(`Qty-weighted Average: €${summary.qtyAvgPrice}`);
      console.log(`High (max): €${summary.maxPrice}`);
      console.log(`Units sold: ${summary.totalQuantity}`);
      console.log(`Detailed orders returned: ${result!.priceDetails.length}`);

      expect(summary.itemNo).toBe(testItemNo);
      expect(summary.guideType).toBe("sold");
      expect(summary.condition).toBe("N");
      expect(summary.currencyCode).toBe("EUR");
      expect(summary.vatIncluded).toBe(false);
      expect(summary.priceBasis).toBe("EX_VAT_BRICKLINK_PRICE_GUIDE");

      if (summary.minPrice !== null && summary.maxPrice !== null) {
        expect(summary.minPrice).toBeGreaterThan(0);
        expect(summary.maxPrice).toBeGreaterThanOrEqual(summary.minPrice);
      }

      for (const entry of result!.priceDetails) {
        expect(entry.unitPrice).toBeGreaterThan(0);
        expect(entry.quantity).toBeGreaterThan(0);
        // Ensure no fake seller
        expect((entry as unknown as Record<string, unknown>).seller).toBeUndefined();
      }
    }, 25000);

    it("retrieves and strictly validates SOLD / USED Price Guide", async () => {
      const result = await client.getPriceGuide({
        itemType: "SET",
        itemNo: testItemNo,
        guideType: "sold",
        condition: "U",
        currencyCode: "EUR",
      });

      expect(result).not.toBeNull();
      const summary = result!.summary;

      console.log("\n--- BRICKLINK — SET 10316-1 — SOLD — USED ---");
      console.log(`Low: €${summary.minPrice} | Avg: €${summary.avgPrice} | High: €${summary.maxPrice} | Lots: ${result!.priceDetails.length}`);

      expect(summary.guideType).toBe("sold");
      expect(summary.condition).toBe("U");
      expect(summary.currencyCode).toBe("EUR");
    }, 25000);

    it("retrieves and strictly validates STOCK / NEW Price Guide", async () => {
      const result = await client.getPriceGuide({
        itemType: "SET",
        itemNo: testItemNo,
        guideType: "stock",
        condition: "N",
        currencyCode: "EUR",
      });

      expect(result).not.toBeNull();
      const summary = result!.summary;

      console.log("\n--- BRICKLINK — SET 10316-1 — STOCK — NEW ---");
      console.log(`Low: €${summary.minPrice} | Avg: €${summary.avgPrice} | High: €${summary.maxPrice} | Lots: ${result!.priceDetails.length}`);

      expect(summary.guideType).toBe("stock");
      expect(summary.condition).toBe("N");
      expect(summary.currencyCode).toBe("EUR");
    }, 25000);

    it("retrieves and strictly validates STOCK / USED Price Guide", async () => {
      const result = await client.getPriceGuide({
        itemType: "SET",
        itemNo: testItemNo,
        guideType: "stock",
        condition: "U",
        currencyCode: "EUR",
      });

      expect(result).not.toBeNull();
      const summary = result!.summary;

      console.log("\n--- BRICKLINK — SET 10316-1 — STOCK — USED ---");
      console.log(`Low: €${summary.minPrice} | Avg: €${summary.avgPrice} | High: €${summary.maxPrice} | Lots: ${result!.priceDetails.length}`);

      expect(summary.guideType).toBe("stock");
      expect(summary.condition).toBe("U");
      expect(summary.currencyCode).toBe("EUR");
    }, 25000);

    it("executes full BrickLinkProvider.searchMarket integration for 10316", async () => {
      const provider = new BrickLinkProvider(client);
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
      expect(result.evidence.length).toBeGreaterThan(0);

      // Verify no fake seller anywhere
      for (const ev of result.evidence) {
        expect(ev.seller).toBeNull();
        expect(ev.provenance).toBe("LIVE_API");
        expect(ev.marketplace).toBe("BRICKLINK");
        expect(ev.rawMetadata?.vatIncluded).toBe(false);
        expect(ev.rawMetadata?.priceBasis).toBe("EX_VAT_BRICKLINK_PRICE_GUIDE");
        expect(ev.externalUrl).toContain("https://www.bricklink.com/v2/catalog/catalogitem.page?S=10316-1#sale=");
      }

      console.log(`\nBrickLinkProvider returned ${result.evidence.length} total live observations.`);
    }, 35000);
  });
});
