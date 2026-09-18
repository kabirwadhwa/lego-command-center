import { ProductIdentificationService } from "@/services/catalog/productIdentificationService";
import { MultiSourceProviderOrchestrator } from "@/services/pricing/providers/providerOrchestrator";
import { IMarketResearchProvider } from "@/services/pricing/providers/types";
import { ObservationProvenance } from "@prisma/client";
import { PriceEngineService } from "@/services/pricing/priceEngineService";

describe("Regression Invariant Test: LEGO Part 35106 Multi-Source Web Research", () => {
  test("1. Identifier 35106 is resolved as a LEGO_PART, never a LEGO set", async () => {
    const product = await ProductIdentificationService.resolveProduct("35106");
    expect(product.identifierType).toBe("LEGO_PART");
    expect(product.canonicalIdentifier).toBe("35106");
    expect(product.name).toContain("Aircraft Fuselage");
    expect(product.availableColors).toBeDefined();
    expect(product.availableColors?.length).toBeGreaterThan(0);
    expect(product.identificationSources[0].source).toContain("Catalog");
  });

  test("2. When Catawiki returns 0 matches for 35106, secondary provider succeeds and overall research succeeds", async () => {
    const product = await ProductIdentificationService.resolveProduct("35106");

    // Mocked Provider Scenario (Explicitly Mocked Integration Test for CI):
    // Catawiki returns NO_MATCHES because 35106 is a part not typically auctioned individually on Catawiki.
    const mockCatawikiProvider: IMarketResearchProvider = {
      id: "catawiki",
      name: "Catawiki Auctions",
      isConfigured: () => true,
      searchMarket: async () => ({
        providerId: "catawiki",
        providerName: "Catawiki Auctions",
        status: "NO_MATCHES",
        evidence: [],
      }),
    };

    // Another genuine provider (e.g. BrickLink / Web) returns valid genuine evidence for 35106
    const mockBrickLinkProvider: IMarketResearchProvider = {
      id: "bricklink",
      name: "BrickLink Marketplace",
      isConfigured: () => true,
      searchMarket: async () => ({
        providerId: "bricklink",
        providerName: "BrickLink Marketplace",
        status: "SUCCESS",
        evidence: [
          {
            provider: "bricklink",
            marketplace: "BRICKLINK",
            title: "LEGO Aircraft Fuselage 35106 White (Part)",
            price: 12.50,
            currency: "EUR",
            shipping: 3.50,
            condition: "USED_COMPLETE",
            saleType: "SOLD",
            seller: "EuroBricksBelgie",
            externalUrl: "https://www.bricklink.com/v2/catalog/catalogitem.page?P=35106#T=S&C=1",
            observedAt: new Date("2026-03-10"),
            productMatchScore: 0.95,
            provenance: ObservationProvenance.LIVE_API,
            color: "White",
          },
          {
            provider: "bricklink",
            marketplace: "BRICKLINK",
            title: "LEGO 35106 Aircraft Fuselage Light Bluish Gray",
            price: 14.20,
            currency: "EUR",
            shipping: 3.50,
            condition: "NEW_SEALED",
            saleType: "SOLD",
            seller: "RotterdamBricks",
            externalUrl: "https://www.bricklink.com/v2/catalog/catalogitem.page?P=35106#T=S&C=86",
            observedAt: new Date("2026-03-12"),
            productMatchScore: 0.95,
            provenance: ObservationProvenance.LIVE_API,
            color: "Light Bluish Gray",
          },
          {
            provider: "bricklink",
            marketplace: "BRICKLINK",
            title: "LEGO Part 35106 Curved Fuselage White",
            price: 13.00,
            currency: "EUR",
            shipping: 4.00,
            condition: "USED_COMPLETE",
            saleType: "ACTIVE_LISTING",
            seller: "AntwerpBricks",
            externalUrl: "https://www.bricklink.com/v2/catalog/catalogitem.page?P=35106#T=S&C=1",
            observedAt: new Date("2026-03-15"),
            productMatchScore: 0.95,
            provenance: ObservationProvenance.LIVE_API,
            color: "White",
          },
        ],
      }),
    };

    // Orchestrator coordinates both providers
    const orchestrator = new MultiSourceProviderOrchestrator([
      mockCatawikiProvider,
      mockBrickLinkProvider,
    ]);

    const result = await orchestrator.searchAllProviders(product);

    // Verify Provider Statuses
    const catawikiResult = result.providers.find(p => p.providerId === "catawiki");
    const bricklinkResult = result.providers.find(p => p.providerId === "bricklink");

    expect(catawikiResult?.status).toBe("NO_MATCHES");
    expect(bricklinkResult?.status).toBe("SUCCESS");

    // Overall research succeeds because genuine observations exist from another source
    expect(result.totalGenuineObservations).toBe(3);
    expect(result.sourcesWithDataCount).toBe(1);

    // Verify Color Grouping
    expect(result.evidenceByColor).toBeDefined();
    expect(result.evidenceByColor?.["White"].length).toBe(2);
    expect(result.evidenceByColor?.["Light Bluish Gray"].length).toBe(1);

    // Pricing calculation operates strictly on genuine observations
    const prices = result.combinedEvidence.map(e => e.price);
    const dates = result.combinedEvidence.map(e => e.observedAt || new Date());
    const types = result.combinedEvidence.map(e => e.saleType === "SOLD" ? "SOLD_PRICE" : "ASKING_PRICE");

    const metrics = PriceEngineService.calculateMetrics(prices, dates, types);
    expect(metrics.median).toBe(13.00);
    expect(metrics.min).toBe(12.50);
    expect(metrics.max).toBe(14.20);
    expect(metrics.rawCount).toBe(3);

    // Verify Real Links & Zero Simulation
    for (const obs of result.combinedEvidence) {
      expect(obs.externalUrl.startsWith("https://www.bricklink.com")).toBe(true);
      expect(obs.externalUrl.includes("simulated")).toBe(false);
      expect(obs.seller?.toLowerCase().includes("simulated")).toBe(false);
      expect(obs.provenance).not.toBe(ObservationProvenance.SIMULATED);
    }
  });
});
