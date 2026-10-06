import {
  BrickLinkDirectClient,
  parseBrickLinkPriceString,
  parseBrickLinkMonthHeader,
  BrickLinkDirectItem,
} from "../src/services/bricklink/bricklinkDirectClient";
import { BrickLinkProvider } from "../src/services/pricing/providers/bricklinkProvider";
import { ResolvedLegoProduct } from "../src/services/catalog/productIdentificationService";

describe("BrickLink Direct Client & Workaround Tests", () => {
  describe("parseBrickLinkPriceString", () => {
    it("parses EUR prices with currency symbol or code", () => {
      expect(parseBrickLinkPriceString("EUR 649.99")).toEqual({ price: 649.99, currency: "EUR" });
      expect(parseBrickLinkPriceString("EUR 1,766.45")).toEqual({ price: 1766.45, currency: "EUR" });
    });

    it("parses converted prices with tilde prefix (~EUR)", () => {
      expect(parseBrickLinkPriceString("~EUR 576.24")).toEqual({ price: 576.24, currency: "EUR" });
      expect(parseBrickLinkPriceString("~EUR 292.82")).toEqual({ price: 292.82, currency: "EUR" });
    });

    it("parses USD prices correctly", () => {
      expect(parseBrickLinkPriceString("US $1,999.00")).toEqual({ price: 1999.0, currency: "USD" });
      expect(parseBrickLinkPriceString("US $483.00")).toEqual({ price: 483.0, currency: "USD" });
    });

    it("returns null for invalid or empty inputs", () => {
      expect(parseBrickLinkPriceString(null)).toBeNull();
      expect(parseBrickLinkPriceString("")).toBeNull();
      expect(parseBrickLinkPriceString("N/A")).toBeNull();
    });
  });

  describe("parseBrickLinkMonthHeader", () => {
    it("parses month and year into a Date object", () => {
      const sep = parseBrickLinkMonthHeader("September 2026");
      expect(sep).not.toBeNull();
      expect(sep?.getUTCFullYear()).toBe(2026);
      expect(sep?.getUTCMonth()).toBe(8); // September is 8 (0-indexed)

      const oct = parseBrickLinkMonthHeader("October 2026");
      expect(oct).not.toBeNull();
      expect(oct?.getUTCFullYear()).toBe(2026);
      expect(oct?.getUTCMonth()).toBe(9); // October is 9
    });

    it("returns null for invalid month headers", () => {
      expect(parseBrickLinkMonthHeader(null)).toBeNull();
      expect(parseBrickLinkMonthHeader("Total Lots:")).toBeNull();
      expect(parseBrickLinkMonthHeader("Unknown 2026")).toBeNull();
    });
  });

  describe("HTML Price Guide Parsing", () => {
    const mockHtml = `
      <TABLE class="pcipgMainTable">
        <TR style="background-color: #C0C0C0;">
          <TD>
            <TABLE CLASS="pcipgSummaryTable">
              <TR><TD>Times Sold:</TD><TD><b>40</b></TD></TR>
              <TR><TD>Total Qty:</TD><TD><b>49</b></TD></TR>
              <TR><TD>Min Price:</TD><TD><b>EUR 419.56</b></TD></TR>
              <TR><TD>Avg Price:</TD><TD><b>EUR 620.85</b></TD></TR>
              <TR><TD>Qty Avg Price:</TD><TD><b>EUR 640.57</b></TD></TR>
              <TR><TD>Max Price:</TD><TD><b>EUR 1,766.45</b></TD></TR>
            </TABLE>
          </TD>
          <TD>
            <TABLE CLASS="pcipgSummaryTable">
              <TR><TD>Times Sold:</TD><TD><b>29</b></TD></TR>
              <TR><TD>Total Qty:</TD><TD><b>29</b></TD></TR>
              <TR><TD>Min Price:</TD><TD><b>EUR 26.54</b></TD></TR>
              <TR><TD>Avg Price:</TD><TD><b>EUR 455.03</b></TD></TR>
              <TR><TD>Qty Avg Price:</TD><TD><b>EUR 455.03</b></TD></TR>
              <TR><TD>Max Price:</TD><TD><b>EUR 566.84</b></TD></TR>
            </TABLE>
          </TD>
          <TD>
            <TABLE CLASS="pcipgSummaryTable">
              <TR><TD>Total Lots:</TD><TD><b>256</b></TD></TR>
              <TR><TD>Total Qty:</TD><TD><b>547</b></TD></TR>
              <TR><TD>Min Price:</TD><TD><b>EUR 398.07</b></TD></TR>
              <TR><TD>Avg Price:</TD><TD><b>EUR 998.29</b></TD></TR>
              <TR><TD>Qty Avg Price:</TD><TD><b>EUR 948.94</b></TD></TR>
              <TR><TD>Max Price:</TD><TD><b>EUR 4,462.70</b></TD></TR>
            </TABLE>
          </TD>
          <TD>
            <TABLE CLASS="pcipgSummaryTable">
              <TR><TD>Total Lots:</TD><TD><b>61</b></TD></TR>
              <TR><TD>Total Qty:</TD><TD><b>65</b></TD></TR>
              <TR><TD>Min Price:</TD><TD><b>EUR 334.70</b></TD></TR>
              <TR><TD>Avg Price:</TD><TD><b>EUR 655.11</b></TD></TR>
              <TR><TD>Qty Avg Price:</TD><TD><b>EUR 641.71</b></TD></TR>
              <TR><TD>Max Price:</TD><TD><b>EUR 5,448.00</b></TD></TR>
            </TABLE>
          </TD>
        </TR>
        <TR>
          <TD>
            <TABLE CLASS="pcipgInnerTable">
              <tr><td colspan=3 class="pcipgSubHeader"><b>September 2026</b></td></tr>
              <tr class="pcipgAddTopPadding"><td></td><td><b>Qty</b></td><td><b>Each</b></td></tr>
              <tr><td></td><td>1</td><td>~EUR 576.24</td></tr>
              <tr><td></td><td>2</td><td>~EUR 609.31</td></tr>
              <TR><TD>Total Lots:</TD><TD><b>2</b></TD></TR>
            </TABLE>
          </TD>
          <TD>
            <TABLE CLASS="pcipgInnerTable">
              <tr><td colspan=3 class="pcipgSubHeader"><b>August 2026</b></td></tr>
              <tr><td></td><td>1</td><td>EUR 455.03</td></tr>
            </TABLE>
          </TD>
        </TR>
      </TABLE>
    `;

    it("parses summary tables and transaction rows correctly", async () => {
      const client = new BrickLinkDirectClient();
      const mockItem: BrickLinkDirectItem = {
        idItem: 157691,
        itemNo: "75192-1",
        itemName: "Millennium Falcon",
        itemType: "SET",
      };

      // Mock fetch
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => mockHtml,
      } as unknown as Response);

      const result = await client.fetchPriceGuideTab(157691, mockItem, "EUR");

      // Verify Sold New summary
      expect(result.soldNewSummary.unitQuantity).toBe(40);
      expect(result.soldNewSummary.totalQuantity).toBe(49);
      expect(result.soldNewSummary.minPrice).toBe(419.56);
      expect(result.soldNewSummary.avgPrice).toBe(620.85);
      expect(result.soldNewSummary.qtyAvgPrice).toBe(640.57);
      expect(result.soldNewSummary.maxPrice).toBe(1766.45);

      // Verify Sold Used summary
      expect(result.soldUsedSummary.unitQuantity).toBe(29);
      expect(result.soldUsedSummary.minPrice).toBe(26.54);

      // Verify Stock New summary
      expect(result.stockNewSummary.unitQuantity).toBe(256);
      expect(result.stockNewSummary.totalQuantity).toBe(547);

      // Verify sold transactions extraction
      expect(result.soldTransactions).toHaveLength(3);
      expect(result.soldTransactions[0]).toEqual({
        quantity: 1,
        unitPrice: 576.24,
        currency: "EUR",
        condition: "N",
        dateOrdered: new Date(Date.UTC(2026, 8, 15)),
      });
      expect(result.soldTransactions[1]).toEqual({
        quantity: 2,
        unitPrice: 609.31,
        currency: "EUR",
        condition: "N",
        dateOrdered: new Date(Date.UTC(2026, 8, 15)),
      });
      expect(result.soldTransactions[2]).toEqual({
        quantity: 1,
        unitPrice: 455.03,
        currency: "EUR",
        condition: "U",
        dateOrdered: new Date(Date.UTC(2026, 7, 15)),
      });
    });
  });

  describe("Active Listings Parsing", () => {
    const mockListingsJson = {
      returnCode: 0,
      list: [
        {
          idInv: 559477717,
          codeNew: "N",
          codeComplete: "S",
          mDisplaySalePrice: "EUR 398.07",
          n4Qty: 1,
          strStorename: "BrickLab",
          strSellerUsername: "thebricklab",
          n4SellerFeedbackScore: 98,
          strSellerCountryCode: "HK",
          strDesc: "Brand new sealed",
        },
        {
          idInv: 559477718,
          codeNew: "U",
          codeComplete: "C",
          mDisplaySalePrice: "EUR 334.70",
          n4Qty: 2,
          strStorename: "European Bricks",
          strSellerUsername: "eurobricks",
          n4SellerFeedbackScore: 500,
          strSellerCountryCode: "DE",
          strDesc: "Complete with box",
        },
      ],
    };

    it("parses active listings into typed BrickLinkDirectListing structures", async () => {
      const client = new BrickLinkDirectClient();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockListingsJson,
      } as unknown as Response);

      const listings = await client.fetchActiveListings(157691, "N", 50);
      expect(listings).toHaveLength(2);
      expect(listings[0].idInv).toBe(559477717);
      expect(listings[0].codeNew).toBe("N");
      expect(listings[0].codeComplete).toBe("S");
      expect(listings[0].unitPrice).toBe(398.07);
      expect(listings[0].storeName).toBe("BrickLab");
      expect(listings[0].sellerCountryCode).toBe("HK");
    });
  });

  describe("BrickLinkProvider Workaround Execution", () => {
    it("operates in workaround mode when OAuth credentials are not configured", async () => {
      const mockDirectClient = {
        getFullPriceGuideData: jest.fn().mockResolvedValue({
          item: {
            idItem: 157691,
            itemNo: "75192-1",
            itemName: "Millennium Falcon",
            itemType: "SET",
          },
          soldNewSummary: {
            itemNo: "75192-1",
            itemType: "SET",
            guideType: "sold",
            condition: "N",
            currencyCode: "EUR",
            minPrice: 500.0,
            avgPrice: 650.0,
            qtyAvgPrice: 645.0,
            maxPrice: 800.0,
            unitQuantity: 10,
            totalQuantity: 12,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
          },
          soldUsedSummary: {
            itemNo: "75192-1",
            itemType: "SET",
            guideType: "sold",
            condition: "U",
            currencyCode: "EUR",
            minPrice: 400.0,
            avgPrice: 450.0,
            qtyAvgPrice: 445.0,
            maxPrice: 550.0,
            unitQuantity: 5,
            totalQuantity: 5,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
          },
          stockNewSummary: {
            itemNo: "75192-1",
            itemType: "SET",
            guideType: "stock",
            condition: "N",
            currencyCode: "EUR",
            minPrice: 600.0,
            avgPrice: 750.0,
            qtyAvgPrice: 740.0,
            maxPrice: 1000.0,
            unitQuantity: 50,
            totalQuantity: 80,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
          },
          stockUsedSummary: {
            itemNo: "75192-1",
            itemType: "SET",
            guideType: "stock",
            condition: "U",
            currencyCode: "EUR",
            minPrice: 450.0,
            avgPrice: 500.0,
            qtyAvgPrice: 495.0,
            maxPrice: 600.0,
            unitQuantity: 20,
            totalQuantity: 22,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
          },
          soldTransactions: [
            {
              quantity: 1,
              unitPrice: 650.0,
              currency: "EUR",
              condition: "N",
              dateOrdered: new Date("2026-09-15"),
            },
            {
              quantity: 1,
              unitPrice: 450.0,
              currency: "EUR",
              condition: "U",
              dateOrdered: new Date("2026-08-15"),
            },
          ],
          activeListings: [
            {
              idInv: 123456,
              codeNew: "N",
              codeComplete: "S",
              unitPrice: 620.0,
              currency: "EUR",
              quantity: 1,
              storeName: "StarBricks",
              sellerUsername: "starbricks",
              sellerFeedbackScore: 250,
              sellerCountryCode: "DE",
              description: "MISB",
            },
          ],
        }),
      } as unknown as BrickLinkDirectClient;

      // Ensure OAuth is unconfigured
      delete process.env.BRICKLINK_CONSUMER_KEY;
      delete process.env.BRICKLINK_CONSUMER_SECRET;
      delete process.env.BRICKLINK_TOKEN_VALUE;
      delete process.env.BRICKLINK_TOKEN_SECRET;
      delete process.env.BRICKLINK_DISABLED;

      const provider = new BrickLinkProvider(undefined, mockDirectClient);
      expect(provider.isConfigured()).toBe(true);
      expect(provider.isOfficialOAuthConfigured()).toBe(false);

      const product: ResolvedLegoProduct = {
        input: "75192",
        identifierType: "LEGO_SET",
        canonicalIdentifier: "75192",
        name: "Millennium Falcon",
        theme: "Star Wars",
        year: 2017,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: 1.0,
      };

      const result = await provider.searchMarket(product);
      expect(result.status).toBe("SUCCESS");
      expect(result.diagnosticStatus).toBe("LIVE_SUCCESS");
      expect(result.telemetry?.authMode).toBe("DIRECT_PRICE_GUIDE_WORKAROUND");

      // Verify observations separation
      const soldEvidence = result.evidence.filter((e) => e.saleType === "SOLD");
      const stockEvidence = result.evidence.filter((e) => e.saleType === "ACTIVE_LISTING");

      expect(soldEvidence).toHaveLength(2);
      expect(stockEvidence).toHaveLength(1);

      // Verify completed sales properties
      expect(soldEvidence[0].price).toBe(650.0);
      expect(soldEvidence[0].condition).toBe("NEW_SEALED");
      expect(soldEvidence[0].rawMetadata?.vatIncluded).toBe(false);
      expect(soldEvidence[0].rawMetadata?.priceBasis).toBe("EX_VAT_BRICKLINK_PRICE_GUIDE");

      expect(soldEvidence[1].price).toBe(450.0);
      expect(soldEvidence[1].condition).toBe("USED_COMPLETE");

      // Verify active listing properties
      expect(stockEvidence[0].price).toBe(620.0);
      expect(stockEvidence[0].seller).toBe("StarBricks");
      expect(stockEvidence[0].condition).toBe("NEW_SEALED");
      expect(stockEvidence[0].rawMetadata?.sellerCountryCode).toBe("DE");
    });

    it("correctly identifies and formats BrickLink minifigure queries (e.g. sw0001a)", async () => {
      const { ProductIdentificationService } = await import(
        "../src/services/catalog/productIdentificationService"
      );
      const resolved = await ProductIdentificationService.resolveProduct("sw0001a");
      expect(resolved.identifierType).toBe("LEGO_MINIFIG");
      expect(resolved.canonicalIdentifier).toBe("sw0001a");

      const mockDirectClient = {
        getFullPriceGuideData: jest.fn().mockResolvedValue({
          item: {
            idItem: 54486,
            itemNo: "sw0001a",
            itemName: "Battle Droid",
            itemType: "MINIFIG",
            newQty: 10,
            usedQty: 50,
          },
          soldNewSummary: { minPrice: 1.5, avgPrice: 2.0, qtyAvgPrice: 1.9, maxPrice: 3.5, unitQuantity: 10, totalQuantity: 15 },
          soldUsedSummary: { minPrice: 0.8, avgPrice: 1.2, qtyAvgPrice: 1.1, maxPrice: 2.0, unitQuantity: 20, totalQuantity: 30 },
          stockNewSummary: { minPrice: 1.8, avgPrice: 2.2, qtyAvgPrice: 2.1, maxPrice: 4.0, unitQuantity: 15, totalQuantity: 25 },
          stockUsedSummary: { minPrice: 0.9, avgPrice: 1.3, qtyAvgPrice: 1.2, maxPrice: 2.5, unitQuantity: 25, totalQuantity: 40 },
          soldTransactions: [
            { quantity: 1, unitPrice: 2.1, currency: "EUR", condition: "N", dateOrdered: new Date("2026-09-15") },
          ],
          activeListings: [
            { idInv: 99999, unitPrice: 2.5, currency: "EUR", codeNew: "N", sellerUsername: "DroidShop", countryCode: "FR" },
          ],
        }),
      } as unknown as BrickLinkDirectClient;

      const provider = new BrickLinkProvider(undefined, mockDirectClient);
      const result = await provider.searchMarket(resolved);

      expect(result.status).toBe("SUCCESS");
      expect(result.evidence).toHaveLength(2);
      expect(result.evidence[0].title).toContain("LEGO Minifig sw0001a");
      expect(result.evidence[0].externalUrl).toContain("catalogitem.page?M=sw0001a");
    });
  });
});
