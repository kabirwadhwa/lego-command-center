import { ObservationProvenance, PriceType } from "@prisma/client";
import {
  CatawikiScraperService,
  buildCatawikiSearchQueries,
} from "@/services/scraper/catawikiScraper";
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
        diagnosticStatus: "NOT_CONFIGURED",
        evidence: [],
        error: "Catawiki scraper unconfigured: APIFY_API_TOKEN environment variable is missing.",
      };
    }

    const queries = buildCatawikiSearchQueries(product.canonicalIdentifier, product);

    try {
      const { lots, telemetry } = await CatawikiScraperService.fetchMarketObservationsWithTelemetry({
        identifier: product.canonicalIdentifier,
        productName: product.name,
        identifierType: product.identifierType,
        queries,
      });

      if (telemetry.status === "AUTH_FAILED") {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "FAILED",
          diagnosticStatus: "AUTH_FAILED",
          evidence: [],
          error: telemetry.errorMessage || "Apify authentication failed. Check APIFY_API_TOKEN.",
          queriesAttempted: telemetry.queriesAttempted,
          rawResultCount: 0,
          acceptedResultCount: 0,
          rejectedResultCount: 0,
          rejectionReasonCounts: telemetry.rejectionReasonCounts,
        };
      }

      if (telemetry.status === "TIMEOUT" || telemetry.status === "PROVIDER_FAILED") {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "FAILED",
          diagnosticStatus: telemetry.status,
          evidence: [],
          error: telemetry.errorMessage || "Catawiki scraper request failed.",
          queriesAttempted: telemetry.queriesAttempted,
          rawResultCount: telemetry.rawResultCount,
          acceptedResultCount: 0,
          rejectedResultCount: telemetry.rejectedResultCount,
          rejectionReasonCounts: telemetry.rejectionReasonCounts,
        };
      }

      if (!lots || lots.length === 0) {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "NO_MATCHES",
          diagnosticStatus: telemetry.status,
          evidence: [],
          queriesAttempted: telemetry.queriesAttempted,
          rawResultCount: telemetry.rawResultCount,
          acceptedResultCount: 0,
          rejectedResultCount: telemetry.rejectedResultCount,
          rejectionReasonCounts: telemetry.rejectionReasonCounts,
        };
      }

      const validatedEvidence: MarketEvidence[] = [];

      for (const lot of lots) {
        let saleType: SaleType = "UNKNOWN";
        if (lot.priceType === PriceType.SOLD_PRICE) {
          saleType = "SOLD";
        } else if (lot.priceType === PriceType.CURRENT_BID) {
          saleType = "AUCTION";
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

      const diagnosticStatus = validatedEvidence.length > 0 ? "LIVE_SUCCESS" : "RESULTS_REJECTED";
      const status = validatedEvidence.length > 0 ? "SUCCESS" : "NO_MATCHES";

      return {
        providerId: this.id,
        providerName: this.name,
        status,
        diagnosticStatus,
        evidence: validatedEvidence,
        queriesAttempted: telemetry.queriesAttempted,
        rawResultCount: telemetry.rawResultCount,
        acceptedResultCount: validatedEvidence.length,
        rejectedResultCount: telemetry.rawResultCount - validatedEvidence.length,
        rejectionReasonCounts: telemetry.rejectionReasonCounts,
      };
    } catch (err) {
      console.error(`[CatawikiProvider] Search failed for ${product.canonicalIdentifier}:`, err);
      const errorMsg = err instanceof Error ? err.message : "Catawiki scraper request failed";
      return {
        providerId: this.id,
        providerName: this.name,
        status: "FAILED",
        diagnosticStatus: "PROVIDER_FAILED",
        evidence: [],
        error: errorMsg,
        queriesAttempted: queries,
      };
    }
  }
}
