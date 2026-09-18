import { ProductIdentificationService } from "@/services/catalog/productIdentificationService";
import { MultiSourceProviderOrchestrator } from "@/services/pricing/providers/providerOrchestrator";
import { IMarketResearchProvider } from "@/services/pricing/providers/types";
import { ObservationProvenance } from "@prisma/client";
import { PriceEngineService } from "@/services/pricing/priceEngineService";

/**
 * Explicitly Mocked Multi-Source Integration Tests for Automated CI.
 * These tests verify provider orchestration, deduplication, condition separation,
 * and statistical analysis without making live network requests in CI.
 */
describe("Mocked Multi-Source Integration Tests: Real LEGO Sets (75192, 10316, 42115)", () => {
  test("Resolves LEGO Set 75192, searches multiple providers, separates conditions, and deduplicates", async () => {
    const product = await ProductIdentificationService.resolveProduct("75192");
    expect(product.identifierType).toBe("LEGO_SET");
    expect(product.name).toContain("Millennium Falcon");

    // Mocked Catawiki Provider returning 2 auction results
    const mockCatawiki: IMarketResearchProvider = {
      id: "catawiki",
      name: "Catawiki Auctions",
      isConfigured: () => true,
      searchMarket: async () => ({
        providerId: "catawiki",
        providerName: "Catawiki Auctions",
        status: "SUCCESS",
        evidence: [
          {
            provider: "catawiki",
            marketplace: "CATAWIKI",
            title: "LEGO Star Wars 75192 Millennium Falcon UCS MISB",
            price: 680.00,
            currency: "EUR",
            shipping: 25.00,
            condition: "NEW_SEALED",
            saleType: "SOLD",
            seller: "CollectorBenelux",
            externalUrl: "https://www.catawiki.com/en/l/75192-lot-1",
            observedAt: new Date(),
            productMatchScore: 0.98,
            provenance: ObservationProvenance.LIVE_SCRAPE,
          },
          {
            provider: "catawiki",
            marketplace: "CATAWIKI",
            title: "LEGO 75192 Millennium Falcon Complete with Box",
            price: 520.00,
            currency: "EUR",
            shipping: 30.00,
            condition: "USED_COMPLETE",
            saleType: "SOLD",
            seller: "VintageBrickVault",
            externalUrl: "https://www.catawiki.com/en/l/75192-lot-2",
            observedAt: new Date(),
            productMatchScore: 0.95,
            provenance: ObservationProvenance.LIVE_SCRAPE,
          },
        ],
      }),
    };

    // Mocked eBay Provider returning 2 items (one sold, one active)
    const mockEbay: IMarketResearchProvider = {
      id: "ebay",
      name: "eBay Marketplace",
      isConfigured: () => true,
      searchMarket: async () => ({
        providerId: "ebay",
        providerName: "eBay Marketplace",
        status: "SUCCESS",
        evidence: [
          {
            provider: "ebay",
            marketplace: "EBAY",
            title: "LEGO Star Wars 75192 Millennium Falcon Brand New Sealed",
            price: 700.00,
            currency: "EUR",
            shipping: 0.00,
            condition: "NEW_SEALED",
            saleType: "SOLD",
            seller: "TopRatedSeller_DE",
            externalUrl: "https://www.ebay.com/itm/9876543210",
            observedAt: new Date(),
            productMatchScore: 0.98,
            provenance: ObservationProvenance.LIVE_API,
          },
          {
            provider: "ebay",
            marketplace: "EBAY",
            title: "LEGO 75192 UCS Millennium Falcon Active Listing",
            price: 750.00,
            currency: "EUR",
            shipping: 15.00,
            condition: "NEW_SEALED",
            saleType: "ACTIVE_LISTING",
            seller: "BerlinToys",
            externalUrl: "https://www.ebay.com/itm/1122334455",
            observedAt: new Date(),
            productMatchScore: 0.95,
            provenance: ObservationProvenance.LIVE_API,
          },
        ],
      }),
    };

    // Mocked Web Search Provider returning 1 duplicate of eBay listing and 1 distinct listing
    const mockWebSearch: IMarketResearchProvider = {
      id: "web_search",
      name: "Web Search Engine",
      isConfigured: () => true,
      searchMarket: async () => ({
        providerId: "web_search",
        providerName: "Web Search Engine",
        status: "SUCCESS",
        evidence: [
          // Duplicate of eBay listing #9876543210 (should be deduplicated)
          {
            provider: "web_search",
            marketplace: "EBAY",
            title: "LEGO Star Wars 75192 Millennium Falcon Brand New Sealed",
            price: 700.00,
            currency: "EUR",
            shipping: 0.00,
            condition: "NEW_SEALED",
            saleType: "SOLD",
            seller: "TopRatedSeller_DE",
            externalUrl: "https://www.ebay.com/itm/9876543210?utm_source=google",
            observedAt: new Date(),
            productMatchScore: 0.98,
            provenance: ObservationProvenance.LIVE_SEARCH,
          },
          // Distinct BrickLink listing
          {
            provider: "web_search",
            marketplace: "BRICKLINK",
            title: "LEGO 75192 Millennium Falcon Sealed Set",
            price: 695.00,
            currency: "EUR",
            shipping: 20.00,
            condition: "NEW_SEALED",
            saleType: "ACTIVE_LISTING",
            seller: "BrickKingNL",
            externalUrl: "https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1#T=S&O={%22ss%22:%221%22}",
            observedAt: new Date(),
            productMatchScore: 0.96,
            provenance: ObservationProvenance.LIVE_SEARCH,
          },
        ],
      }),
    };

    const orchestrator = new MultiSourceProviderOrchestrator([
      mockCatawiki,
      mockEbay,
      mockWebSearch,
    ]);

    const result = await orchestrator.searchAllProviders(product);

    // Verify 3 providers succeeded
    expect(result.sourcesWithDataCount).toBe(3);

    // Deduplication check: 5 total unique items (the duplicate eBay item from web search was merged)
    expect(result.totalGenuineObservations).toBe(5);

    // Condition separation check
    expect(result.evidenceByCondition.newSealed.length).toBe(4);
    expect(result.evidenceByCondition.usedComplete.length).toBe(1);

    // Statistical price calculation
    const prices = result.combinedEvidence.map(e => e.price);
    const dates = result.combinedEvidence.map(e => e.observedAt || new Date());
    const types = result.combinedEvidence.map(e => e.saleType === "SOLD" ? "SOLD_PRICE" : "ASKING_PRICE");

    const metrics = PriceEngineService.calculateMetrics(prices, dates, types);
    expect(metrics.median).toBe(695.00);
    expect(metrics.min).toBe(680.00);
    expect(metrics.max).toBe(700.00);
    expect(metrics.confidenceTier).toBe("MEDIUM");

    // Invariant: all URLs are genuine external URLs
    for (const ev of result.combinedEvidence) {
      expect(ev.externalUrl.startsWith("https://")).toBe(true);
      expect(ev.externalUrl.includes("simulated")).toBe(false);
    }
  });

  test("Resolves LEGO Set 10316 (Rivendell) and gracefully reports unconfigured providers", async () => {
    const product = await ProductIdentificationService.resolveProduct("10316");
    expect(product.identifierType).toBe("LEGO_SET");

    // Unconfigured Web Search Provider
    const unconfiguredWebSearch: IMarketResearchProvider = {
      id: "web_search",
      name: "Web Search Engine",
      isConfigured: () => false,
      searchMarket: async () => ({
        providerId: "web_search",
        providerName: "Web Search Engine",
        status: "NOT_CONFIGURED",
        evidence: [],
        error: "Web Search unconfigured: API keys missing.",
      }),
    };

    // Configured eBay provider
    const mockEbay: IMarketResearchProvider = {
      id: "ebay",
      name: "eBay",
      isConfigured: () => true,
      searchMarket: async () => ({
        providerId: "ebay",
        providerName: "eBay",
        status: "SUCCESS",
        evidence: [
          {
            provider: "ebay",
            marketplace: "EBAY",
            title: "LEGO 10316 The Lord of the Rings Rivendell New In Box",
            price: 430.00,
            currency: "EUR",
            shipping: 10.00,
            condition: "NEW_SEALED",
            saleType: "SOLD",
            seller: "LotrFanatic",
            externalUrl: "https://www.ebay.com/itm/103160001",
            observedAt: new Date(),
            productMatchScore: 0.98,
            provenance: ObservationProvenance.LIVE_API,
          },
          {
            provider: "ebay",
            marketplace: "EBAY",
            title: "LEGO 10316 Rivendell Complete",
            price: 410.00,
            currency: "EUR",
            shipping: 12.00,
            condition: "USED_COMPLETE",
            saleType: "SOLD",
            seller: "GondorBricks",
            externalUrl: "https://www.ebay.com/itm/103160002",
            observedAt: new Date(),
            productMatchScore: 0.97,
            provenance: ObservationProvenance.LIVE_API,
          },
        ],
      }),
    };

    const orchestrator = new MultiSourceProviderOrchestrator([
      unconfiguredWebSearch,
      mockEbay,
    ]);

    const result = await orchestrator.searchAllProviders(product);

    expect(result.providers.find(p => p.providerId === "web_search")?.status).toBe("NOT_CONFIGURED");
    expect(result.providers.find(p => p.providerId === "ebay")?.status).toBe("SUCCESS");
    expect(result.totalGenuineObservations).toBe(2);
    expect(result.sourcesWithDataCount).toBe(1);
  });
});
