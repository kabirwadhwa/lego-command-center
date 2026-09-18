import { ObservationProvenance, PriceType } from "@prisma/client";
import { CatawikiScraperService } from "@/services/scraper/catawikiScraper";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult, SaleType } from "./types";
import { EvidenceValidator } from "./evidenceValidator";

export class CatawikiProvider implements IMarketResearchProvider {
  id = "catawiki";
  name = "Catawiki Auctions";

  isConfigured(): boolean {
    return !!process.env.APIFY_API_TOKEN;
  }

  async searchMarket(
    product: ResolvedLegoProduct
  ): Promise<ProviderResult> {
    if (!this.isConfigured()) {
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NOT_CONFIGURED",
        evidence: [],
        error: "Catawiki scraper unconfigured: APIFY_API_TOKEN environment variable is missing.",
      };
    }

    const query = product.canonicalIdentifier;
    const queriesAttempted = [`Catawiki auctions for ${query}`];

    try {
      const scrapedLots = await CatawikiScraperService.fetchMarketObservations(query);

      if (!scrapedLots || scrapedLots.length === 0) {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "NO_MATCHES",
          evidence: [],
          queriesAttempted,
        };
      }

      const validatedEvidence: MarketEvidence[] = [];

      for (const lot of scrapedLots) {
        let saleType: SaleType = "AUCTION";
        if (lot.priceType === PriceType.SOLD_PRICE) {
          saleType = "SOLD";
        } else if (lot.priceType === PriceType.ASKING_PRICE || lot.priceType === PriceType.BUY_NOW) {
          saleType = "ACTIVE_LISTING";
        }

        if (!lot.externalUrl) continue;

        const candidate = EvidenceValidator.validateCandidate({
          provider: this.id,
          marketplace: "CATAWIKI",
          title: lot.title || `LEGO ${product.canonicalIdentifier}`,
          price: lot.price,
          currency: lot.currency,
          shipping: lot.shippingCost ?? null,
          condition: lot.condition ?? null,
          saleType,
          seller: lot.seller ?? null,
          externalUrl: lot.externalUrl,
          observedAt: lot.capturedAt,
          canonicalIdentifier: product.canonicalIdentifier,
          productName: product.name,
          provenance: ObservationProvenance.LIVE_SCRAPE,
          rawMetadata: {
            externalListingId: lot.externalListingId,
            rawMetadataJson: lot.rawMetadataJson,
          },
        });

        if (candidate) {
          validatedEvidence.push(candidate);
        }
      }

      return {
        providerId: this.id,
        providerName: this.name,
        status: validatedEvidence.length > 0 ? "SUCCESS" : "NO_MATCHES",
        evidence: validatedEvidence,
        queriesAttempted,
      };
    } catch (err) {
      console.error(`[CatawikiProvider] Search failed for ${query}:`, err);
      const errorMsg = err instanceof Error ? err.message : "Catawiki scraper request failed";
      return {
        providerId: this.id,
        providerName: this.name,
        status: "FAILED",
        evidence: [],
        error: errorMsg,
        queriesAttempted,
      };
    }
  }
}
