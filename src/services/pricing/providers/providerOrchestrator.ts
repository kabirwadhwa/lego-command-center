import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult } from "./types";
import { CatawikiProvider } from "./catawikiProvider";
import { EbayProvider } from "./ebayProvider";
import { BrickLinkProvider } from "./bricklinkProvider";
import { WebSearchProvider } from "./webSearchProvider";
import { EvidenceValidator } from "./evidenceValidator";

export interface MultiSourceResearchResult {
  product: ResolvedLegoProduct;
  providers: ProviderResult[];
  combinedEvidence: MarketEvidence[];
  evidenceByColor?: Record<string, MarketEvidence[]>;
  evidenceByCondition: {
    newSealed: MarketEvidence[];
    usedComplete: MarketEvidence[];
    other: MarketEvidence[];
  };
  sourcesSearchedCount: number;
  sourcesWithDataCount: number;
  totalGenuineObservations: number;
}

export class MultiSourceProviderOrchestrator {
  private providers: IMarketResearchProvider[];

  constructor(customProviders?: IMarketResearchProvider[]) {
    this.providers = customProviders || [
      new CatawikiProvider(),
      new EbayProvider(),
      new BrickLinkProvider(),
      new WebSearchProvider(),
    ];
  }

  getProviders(): IMarketResearchProvider[] {
    return this.providers;
  }

  /**
   * Searches all registered providers in parallel with Promise.allSettled.
   * Ensures one failing or unconfigured provider never blocks others.
   */
  async searchAllProviders(
    product: ResolvedLegoProduct,
    options?: { forceRefresh?: boolean }
  ): Promise<MultiSourceResearchResult> {
    const settledPromises = await Promise.allSettled(
      this.providers.map(async (provider) => {
        try {
          return await provider.searchMarket(product, options);
        } catch (err) {
          console.error(`[Orchestrator] Provider ${provider.id} unexpected crash:`, err);
          return {
            providerId: provider.id,
            providerName: provider.name,
            status: "FAILED" as const,
            evidence: [],
            error: err instanceof Error ? err.message : "Provider threw an unexpected error",
          };
        }
      })
    );

    const providerResults: ProviderResult[] = [];
    const allEvidence: MarketEvidence[] = [];

    settledPromises.forEach((res, index) => {
      if (res.status === "fulfilled") {
        providerResults.push(res.value);
        if (res.value.evidence && res.value.evidence.length > 0) {
          allEvidence.push(...res.value.evidence);
        }
      } else {
        const fallbackProvider = this.providers[index];
        providerResults.push({
          providerId: fallbackProvider?.id || `provider_${index}`,
          providerName: fallbackProvider?.name || `Provider ${index}`,
          status: "FAILED",
          evidence: [],
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      }
    });

    // Cross-provider deduplication
    const deduplicatedEvidence = EvidenceValidator.deduplicate(allEvidence);

    // Grouping by color (for LEGO_PART)
    let evidenceByColor: Record<string, MarketEvidence[]> | undefined;
    if (product.identifierType === "LEGO_PART") {
      evidenceByColor = {};
      for (const ev of deduplicatedEvidence) {
        const colorKey = ev.color || "Standard / Unspecified";
        if (!evidenceByColor[colorKey]) {
          evidenceByColor[colorKey] = [];
        }
        evidenceByColor[colorKey].push(ev);
      }
    }

    // Grouping by condition
    const evidenceByCondition = {
      newSealed: deduplicatedEvidence.filter(e => e.condition === "NEW_SEALED"),
      usedComplete: deduplicatedEvidence.filter(e => e.condition === "USED_COMPLETE"),
      other: deduplicatedEvidence.filter(e => e.condition !== "NEW_SEALED" && e.condition !== "USED_COMPLETE"),
    };

    const sourcesWithDataCount = providerResults.filter(p => p.status === "SUCCESS" && p.evidence.length > 0).length;

    return {
      product,
      providers: providerResults,
      combinedEvidence: deduplicatedEvidence,
      evidenceByColor,
      evidenceByCondition,
      sourcesSearchedCount: this.providers.length,
      sourcesWithDataCount,
      totalGenuineObservations: deduplicatedEvidence.length,
    };
  }
}
