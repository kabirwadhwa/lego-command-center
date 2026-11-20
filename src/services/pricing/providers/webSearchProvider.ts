import { ObservationProvenance } from "@prisma/client";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult } from "./types";
import { EvidenceValidator } from "./evidenceValidator";
import {
  ISearchDriver,
  SearchResultItem,
  GoogleCustomSearchDriver,
  SerpApiDriver,
  BraveSearchDriver,
  DuckDuckGoHtmlDriver,
  stripSearchHtml,
  createDefaultDrivers,
  selectActiveDriver,
} from "./searchDrivers";

// Re-exported so existing importers keep working.
export type { ISearchDriver, SearchResultItem };
export {
  GoogleCustomSearchDriver,
  SerpApiDriver,
  BraveSearchDriver,
  DuckDuckGoHtmlDriver,
  stripSearchHtml,
  createDefaultDrivers,
  selectActiveDriver,
};

export class WebSearchProvider implements IMarketResearchProvider {
  id = "web_search";
  name = "Web Search Engine";

  /**
   * Keyed drivers first — they are higher quality when configured. The
   * keyless DuckDuckGo driver is last so that web search always has a
   * working engine even with no environment variables set at all.
   */
  private drivers: ISearchDriver[] = createDefaultDrivers();

  getActiveDriver(): ISearchDriver | null {
    return selectActiveDriver(this.drivers);
  }

  isConfigured(): boolean {
    return this.getActiveDriver() !== null;
  }

  buildQueries(product: ResolvedLegoProduct): string[] {
    const id = product.canonicalIdentifier;
    if (product.identifierType === "LEGO_PART") {
      return [
        `"LEGO ${id}" price`,
        `"LEGO part ${id}"`,
        `"LEGO ${id}" eBay`,
        `"LEGO ${id}" BrickLink`,
      ];
    }

    return [
      `"LEGO ${id}" price`,
      `"LEGO ${id}" sold`,
      `"LEGO ${id}" eBay`,
      `"LEGO ${id}" BrickLink`,
      `"LEGO ${id}" Catawiki`,
    ];
  }

  async searchMarket(
    product: ResolvedLegoProduct
  ): Promise<ProviderResult> {
    const driver = this.getActiveDriver();

    if (!driver) {
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NOT_CONFIGURED",
        evidence: [],
        error: "Web Search unconfigured. Set GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID, SERPAPI_API_KEY, or BRAVE_SEARCH_API_KEY in environment variables.",
      };
    }

    const queries = this.buildQueries(product);
    const candidateItems: SearchResultItem[] = [];
    const errors: string[] = [];

    // Query top 2 queries to avoid rate limits
    const queriesToRun = queries.slice(0, 2);

    for (const q of queriesToRun) {
      try {
        const items = await driver.search(q);
        candidateItems.push(...items);
      } catch (err) {
        console.warn(`[WebSearchProvider] Query "${q}" failed:`, err);
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (candidateItems.length === 0) {
      return {
        providerId: this.id,
        providerName: `${this.name} (${driver.name})`,
        status: errors.length > 0 ? "FAILED" : "NO_MATCHES",
        evidence: [],
        error: errors.length > 0 ? errors.join("; ") : undefined,
        queriesAttempted: queriesToRun,
      };
    }

    // Verify candidates using EvidenceValidator
    const validatedEvidence: MarketEvidence[] = [];

    for (const item of candidateItems) {
      const hostname = (() => {
        try {
          return new URL(item.link).hostname.replace(/^www\./, "").toUpperCase();
        } catch {
          return "WEB";
        }
      })();

      const candidate = EvidenceValidator.validateCandidate({
        provider: this.id,
        marketplace: hostname,
        title: item.title,
        rawTextForExtraction: item.snippet,
        externalUrl: item.link,
        canonicalIdentifier: product.canonicalIdentifier,
        productName: product.name,
        provenance: ObservationProvenance.LIVE_SEARCH,
      });

      if (candidate) {
        validatedEvidence.push(candidate);
      }
    }

    const deduplicated = EvidenceValidator.deduplicate(validatedEvidence);

    return {
      providerId: this.id,
      providerName: `${this.name} (${driver.name})`,
      status: deduplicated.length > 0 ? "SUCCESS" : "NO_MATCHES",
      evidence: deduplicated,
      queriesAttempted: queriesToRun,
    };
  }
}
