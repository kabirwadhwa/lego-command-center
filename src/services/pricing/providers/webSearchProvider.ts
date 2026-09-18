import { ObservationProvenance } from "@prisma/client";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult } from "./types";
import { EvidenceValidator } from "./evidenceValidator";

export interface SearchResultItem {
  title: string;
  snippet: string;
  link: string;
  pagemap?: Record<string, unknown>;
}

export interface ISearchDriver {
  name: string;
  isConfigured(): boolean;
  search(query: string): Promise<SearchResultItem[]>;
}

/**
 * Google Custom Search JSON API Driver
 */
class GoogleCustomSearchDriver implements ISearchDriver {
  name = "Google Custom Search";

  isConfigured(): boolean {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID;
    return !!(key && cx);
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID;
    if (!key || !cx) return [];

    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Search API HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const items = data?.items || [];
    return items.map((it: { title?: string; snippet?: string; link?: string; pagemap?: Record<string, unknown> }) => ({
      title: it.title || "",
      snippet: it.snippet || "",
      link: it.link || "",
      pagemap: it.pagemap,
    }));
  }
}

/**
 * SerpAPI Driver
 */
class SerpApiDriver implements ISearchDriver {
  name = "SerpAPI";

  isConfigured(): boolean {
    return !!process.env.SERPAPI_API_KEY;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) return [];

    const url = `https://serpapi.com/search.json?engine=google&api_key=${apiKey}&q=${encodeURIComponent(query)}&num=10`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SerpAPI HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = data?.organic_results || [];
    return results.map((r: { title?: string; snippet?: string; link?: string }) => ({
      title: r.title || "",
      snippet: r.snippet || "",
      link: r.link || "",
    }));
  }
}

/**
 * Brave Search API Driver
 */
class BraveSearchDriver implements ISearchDriver {
  name = "Brave Search API";

  isConfigured(): boolean {
    return !!process.env.BRAVE_SEARCH_API_KEY;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) return [];

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave Search HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = data?.web?.results || [];
    return results.map((r: { title?: string; description?: string; url?: string }) => ({
      title: r.title || "",
      snippet: r.description || "",
      link: r.url || "",
    }));
  }
}

export class WebSearchProvider implements IMarketResearchProvider {
  id = "web_search";
  name = "Web Search Engine";

  private drivers: ISearchDriver[] = [
    new GoogleCustomSearchDriver(),
    new SerpApiDriver(),
    new BraveSearchDriver(),
  ];

  getActiveDriver(): ISearchDriver | null {
    return this.drivers.find(d => d.isConfigured()) || null;
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
