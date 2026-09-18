import prisma from "@/lib/prisma";
import { ObservationProvenance, PriceType, Prisma } from "@prisma/client";
import {
  ProductIdentificationService,
  ResolvedLegoProduct,
} from "@/services/catalog/productIdentificationService";
import {
  MultiSourceProviderOrchestrator,
} from "./providers/providerOrchestrator";
import { ProviderResult } from "./providers/types";
import { PriceEngineService, ConfidenceTier } from "./priceEngineService";
import {
  getFeeStructure,
  calculateBreakevenFloor,
  calculateChannelProceeds,
} from "./feeService";
import {
  isEligibleForRealMarketPricing,
  GENUINE_PROVENANCES,
  isGenuineListingUrl,
} from "./evidenceEligibility";

export interface PricingResearchObservation {
  id: string;
  source: string;
  marketplace: string;
  price: number;
  currency: string;
  priceType: PriceType | string;
  condition?: string | null;
  capturedAt: Date | string;
  provenance: ObservationProvenance | string;
  seller?: string | null;
  externalUrl?: string | null;
  availability?: boolean;
  color?: string | null;
  productMatchScore?: number;
}

export interface PurchaseScenario {
  hypotheticalCost: number;
  targetChannel: string;
  estimatedSellingPrice: number | null;
  estimatedFees: number | null;
  estimatedShipping: number | null;
  estimatedNetProceeds: number | null;
  potentialProfit: number | null;
  potentialMargin: number | null; // percentage
  breakevenPrice: number | null;
  potentialRoi: number | null; // percentage
}

export type ResearchStatus =
  | "SUCCESS"
  | "INSUFFICIENT_DATA"
  | "NO_DATA"
  | "EXTERNAL_SOURCE_FAILURE";

export interface PricingResearchResult {
  productId?: string;
  setNumber: string;
  productName: string;
  theme?: string | null;
  imageUrl?: string | null;
  ean?: string | null;
  metadataAvailable: boolean;
  resolvedProduct?: ResolvedLegoProduct;
  providerStatuses: ProviderResult[];
  evidenceByColor?: Record<string, PricingResearchObservation[]>;
  observationCount: number;
  soldObservationCount: number;
  askingObservationCount: number;
  currentBidObservationCount: number;
  medianPrice: number | null;
  meanPrice: number | null;
  minimumObservedPrice: number | null;
  maximumObservedPrice: number | null;
  confidenceScore: number | null;
  confidenceTier: ConfidenceTier | "Unknown";
  recommendedMarketPrice: number | null;
  currency: string;
  latestObservationAt: Date | string | null;
  sources: string[];
  observations: PricingResearchObservation[];
  status: ResearchStatus;
  targetChannel: string;
  purchaseScenario?: PurchaseScenario | null;
  isStale?: boolean;
  researchTimestamp: Date | string;
  message?: string;
}

export class MarketResearchService {
  /**
   * Normalizes LEGO set number input.
   * Strips whitespace, removes trailing "-1" (BrickLink/Rebrickable variant notation),
   * and verifies character validity.
   */
  static normalizeSetNumber(input: string): string {
    return ProductIdentificationService.normalizeIdentifier(input).toUpperCase();
  }

  /**
   * Validates format of LEGO set/product numbers.
   */
  static isValidSetNumber(setNumber: string): boolean {
    if (!setNumber || setNumber.length < 3 || setNumber.length > 20) return false;
    return /^[0-9A-Z-_.]+$/i.test(setNumber);
  }

  /**
   * Resolves LEGO product metadata without fabricating information.
   * Uses the comprehensive ProductIdentificationService.
   */
  static async resolveProductMetadata(
    identifier: string,
    userProvidedName?: string,
    userProvidedTheme?: string
  ): Promise<{
    id?: string;
    setNumber: string;
    name: string;
    theme: string | null;
    imageUrl: string | null;
    ean: string | null;
    metadataAvailable: boolean;
    resolvedProduct: ResolvedLegoProduct;
  }> {
    const resolved = await ProductIdentificationService.resolveProduct(identifier);

    // Apply user overrides if provided
    if (userProvidedName && userProvidedName.trim()) {
      resolved.name = userProvidedName.trim();
    }
    if (userProvidedTheme && userProvidedTheme.trim()) {
      resolved.theme = userProvidedTheme.trim();
    }

    const metadataAvailable = resolved.name !== null && resolved.identifierType !== "UNKNOWN";

    return {
      setNumber: resolved.canonicalIdentifier || identifier,
      name: resolved.name || (metadataAvailable ? resolved.name! : "Product metadata unavailable"),
      theme: resolved.theme || null,
      imageUrl: resolved.imageUrl || null,
      ean: resolved.ean || null,
      metadataAvailable,
      resolvedProduct: resolved,
    };
  }

  /**
   * Resolves or safely creates a Product catalog record WITHOUT creating variants or stock.
   * Quantity remains zero; no inventory transaction is created.
   */
  static async ensureCatalogProduct(metadata: {
    setNumber: string;
    name: string;
    theme?: string | null;
    imageUrl?: string | null;
    ean?: string | null;
    productType?: string;
  }) {
    const existing = await prisma.product.findUnique({
      where: { setNumber: metadata.setNumber },
    });

    if (existing) return existing;

    return await prisma.product.create({
      data: {
        setNumber: metadata.setNumber,
        name: metadata.name,
        theme: metadata.theme || "General",
        imageUrl: metadata.imageUrl || null,
        ean: metadata.ean || null,
        productType: metadata.productType || "LEGO_SET",
        status: "ACTIVE",
      },
    });
  }

  /**
   * Fetches genuine market observations adhering to 6-hour freshness across all providers.
   * Never uses synthetic/simulated observations in any environment.
   */
  static async getMarketObservations(
    productId: string,
    canonicalIdentifier: string,
    forceRefresh: boolean = false,
    resolvedProduct?: ResolvedLegoProduct
  ): Promise<{
    observations: PricingResearchObservation[];
    providerStatuses: ProviderResult[];
    isStale: boolean;
    sourceError?: string;
  }> {
    const allowedProvenances: ObservationProvenance[] = [...GENUINE_PROVENANCES];

    // Check existing stored snapshots in DB
    const existingSnapshotsRaw = await prisma.marketPriceSnapshot.findMany({
      where: {
        productId,
        provenance: { in: allowedProvenances },
      },
      orderBy: { capturedAt: "desc" },
    });
    const existingSnapshots = existingSnapshotsRaw.filter(isEligibleForRealMarketPricing);

    const now = Date.now();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    let newestCapturedAt = 0;
    if (existingSnapshots.length > 0) {
      newestCapturedAt = existingSnapshots[0].capturedAt.getTime();
    }

    const isFresh = existingSnapshots.length > 0 && (now - newestCapturedAt) <= SIX_HOURS_MS;

    // Check if we have cached provider status metadata in history
    let cachedProviderStatuses: ProviderResult[] = [];
    const latestHistory = await prisma.legoResearchHistory.findFirst({
      where: { setNumber: canonicalIdentifier },
      orderBy: { researchedAt: "desc" },
    });

    if (latestHistory?.resolvedMetadataJson) {
      try {
        const meta = JSON.parse(latestHistory.resolvedMetadataJson);
        if (Array.isArray(meta.providerStatuses)) {
          cachedProviderStatuses = meta.providerStatuses;
        }
      } catch {
        // ignore parse error
      }
    }

    // Return cached if fresh and not force-refreshing
    if (existingSnapshots.length > 0 && isFresh && !forceRefresh) {
      return {
        observations: existingSnapshots.map(s => this.mapSnapshotToObservation(s)),
        providerStatuses: cachedProviderStatuses.length > 0
          ? cachedProviderStatuses
          : [{ providerId: "cached", providerName: "Cached Evidence", status: "SUCCESS", evidence: [] }],
        isStale: false,
      };
    }

    // If stale but NOT force-refreshing, return cached with stale indicator
    if (existingSnapshots.length > 0 && !forceRefresh) {
      return {
        observations: existingSnapshots.map(s => this.mapSnapshotToObservation(s)),
        providerStatuses: cachedProviderStatuses.length > 0
          ? cachedProviderStatuses
          : [{ providerId: "cached", providerName: "Cached Evidence", status: "SUCCESS", evidence: [] }],
        isStale: true,
      };
    }

    // Resolve product if not passed
    const product = resolvedProduct || await ProductIdentificationService.resolveProduct(canonicalIdentifier);

    // Multi-source sweep across all providers
    const orchestrator = new MultiSourceProviderOrchestrator();
    const multiResult = await orchestrator.searchAllProviders(product, { forceRefresh });

    // Invariant: unconditionally filter lots through isEligibleForRealMarketPricing
    const validEvidence = multiResult.combinedEvidence.filter(isEligibleForRealMarketPricing);

    // Persist newly fetched valid evidence into MarketPriceSnapshot
    for (const ev of validEvidence) {
      // Map saleType to PriceType
      let pType: PriceType = PriceType.ASKING_PRICE;
      if (ev.saleType === "SOLD") pType = PriceType.SOLD_PRICE;
      else if (ev.saleType === "AUCTION") pType = PriceType.CURRENT_BID;

      const existing = await prisma.marketPriceSnapshot.findFirst({
        where: {
          productId,
          externalUrl: ev.externalUrl,
        },
      });

      if (!existing) {
        await prisma.marketPriceSnapshot.create({
          data: {
            productId,
            marketplace: ev.marketplace,
            price: new Prisma.Decimal(ev.price),
            priceType: pType,
            currency: ev.currency,
            shipping: ev.shipping !== null ? new Prisma.Decimal(ev.shipping) : null,
            condition: ev.condition,
            seller: ev.seller,
            externalUrl: ev.externalUrl,
            capturedAt: ev.observedAt || new Date(),
            availability: true,
            provenance: ev.provenance,
            provider: ev.provider,
            rawMetadataJson: JSON.stringify({
              color: ev.color,
              productMatchScore: ev.productMatchScore,
              originalPrice: ev.originalPrice,
              originalCurrency: ev.originalCurrency,
            }),
          },
        });
      }
    }

    // Re-query all valid snapshots
    const allSnapshotsRaw = await prisma.marketPriceSnapshot.findMany({
      where: {
        productId,
        provenance: { in: allowedProvenances },
      },
      orderBy: { capturedAt: "desc" },
    });
    const allSnapshots = allSnapshotsRaw.filter(isEligibleForRealMarketPricing);

    return {
      observations: allSnapshots.map(s => this.mapSnapshotToObservation(s)),
      providerStatuses: multiResult.providers,
      isStale: false,
    };
  }

  private static mapSnapshotToObservation(snapshot: {
    id: string;
    marketplace: string;
    price: Prisma.Decimal;
    priceType: PriceType;
    currency: string;
    condition?: string | null;
    capturedAt: Date;
    provenance: ObservationProvenance;
    seller?: string | null;
    externalUrl?: string | null;
    availability: boolean;
    rawMetadataJson?: string | null;
  }): PricingResearchObservation {
    const rawSeller = snapshot.seller?.trim();
    const seller = (rawSeller && !rawSeller.toLowerCase().includes("simulated")) ? rawSeller : null;
    const url = (snapshot.externalUrl && isGenuineListingUrl(snapshot.externalUrl)) ? snapshot.externalUrl : null;

    let color: string | null = null;
    let matchScore: number | undefined;

    if (snapshot.rawMetadataJson) {
      try {
        const parsed = JSON.parse(snapshot.rawMetadataJson);
        color = parsed.color || null;
        matchScore = parsed.productMatchScore;
      } catch {
        // ignore
      }
    }

    return {
      id: snapshot.id,
      source: snapshot.marketplace,
      marketplace: snapshot.marketplace,
      price: Number(snapshot.price),
      currency: snapshot.currency,
      priceType: snapshot.priceType,
      condition: snapshot.condition,
      capturedAt: snapshot.capturedAt,
      provenance: snapshot.provenance,
      seller,
      externalUrl: url,
      availability: snapshot.availability,
      color,
      productMatchScore: matchScore,
    };
  }

  /**
   * Executes a complete manual market research operation for ANY LEGO identifier.
   * Researches sets, parts, SKUs, and titles across multiple sources.
   * Does NOT create owned stock, balances, or transactions.
   */
  static async researchLegoSet(params: {
    setNumber: string;
    hypotheticalCost?: number | null;
    targetChannel?: string;
    forceRefresh?: boolean;
    userProductName?: string;
    userTheme?: string;
  }): Promise<PricingResearchResult> {
    const {
      hypotheticalCost = null,
      targetChannel = "CATAWIKI",
      forceRefresh = false,
      userProductName,
      userTheme,
    } = params;

    // 1. Identify product accurately
    const metadata = await this.resolveProductMetadata(
      params.setNumber,
      userProductName,
      userTheme
    );
    const resolved = metadata.resolvedProduct;
    const canonicalId = resolved.canonicalIdentifier || params.setNumber.trim();

    // 2. Ensure a catalog Product record exists (zero inventory, no variants created)
    const product = await this.ensureCatalogProduct({
      setNumber: canonicalId,
      name: metadata.name,
      theme: metadata.theme,
      imageUrl: metadata.imageUrl,
      ean: metadata.ean,
      productType: resolved.identifierType,
    });

    // 3. Multi-source market observations
    const { observations: rawObservations, providerStatuses, isStale } = await this.getMarketObservations(
      product.id,
      canonicalId,
      forceRefresh,
      resolved
    );
    const observations = rawObservations.filter(isEligibleForRealMarketPricing);

    // Group observations by color (for LEGO_PART)
    const evidenceByColor: Record<string, PricingResearchObservation[]> = {};
    if (resolved.identifierType === "LEGO_PART") {
      for (const obs of observations) {
        const c = obs.color || "Standard / Unspecified";
        if (!evidenceByColor[c]) evidenceByColor[c] = [];
        evidenceByColor[c].push(obs);
      }
    }

    const prices = observations.map(o => o.price);
    const capturedDates = observations.map(o => o.capturedAt);
    const priceTypes = observations.map(o => o.priceType);

    const soldCount = observations.filter(o => o.priceType === PriceType.SOLD_PRICE).length;
    const askingCount = observations.filter(o => o.priceType === PriceType.ASKING_PRICE || o.priceType === PriceType.BUY_NOW).length;
    const bidCount = observations.filter(o => o.priceType === PriceType.CURRENT_BID).length;

    const sources = Array.from(new Set(observations.map(o => o.source)));
    const latestObservationAt = observations.length > 0
      ? new Date(Math.max(...observations.map(o => new Date(o.capturedAt).getTime())))
      : null;

    // 4. Source Quality Weighting: prioritize sold transactions over asking/auctions
    let effectivePrices = prices;
    const soldPrices = observations.filter(o => o.priceType === PriceType.SOLD_PRICE).map(o => o.price);

    // If we have >= 2 sold transactions, base the median heavily on sold prices
    if (soldPrices.length >= 2) {
      effectivePrices = soldPrices;
    }

    // 5. Calculate statistical metrics
    const metrics = PriceEngineService.calculateMetrics(effectivePrices, capturedDates, priceTypes);

    // Confidence adjustment for source diversity:
    // If all evidence came from only 1 source or if there are 0 completed sold transactions, cap confidence at MEDIUM
    let finalConfidenceScore: number | null = metrics.confidenceScore;
    let finalConfidenceTier = metrics.confidenceTier;

    if (observations.length >= 2) {
      if (sources.length === 1 && soldCount === 0 && finalConfidenceTier === "HIGH") {
        finalConfidenceTier = "MEDIUM";
        finalConfidenceScore = Math.min(finalConfidenceScore, 75);
      }
      if (resolved.identifierType === "UNKNOWN") {
        finalConfidenceTier = "LOW";
        finalConfidenceScore = Math.min(finalConfidenceScore, 35);
      }
    } else {
      finalConfidenceTier = "INSUFFICIENT";
      finalConfidenceScore = null;
    }

    // 6. Determine recommended market price
    // Invariant: strictly requires >= 2 genuine market observations
    let recommendedPrice: number | null = null;
    if (metrics.median > 0 && observations.length >= 2) {
      recommendedPrice = Math.round((metrics.median * 0.99) * 100) / 100;
    }

    // 7. Fee structure and hypothetical scenario
    const feeStructure = getFeeStructure(targetChannel);
    let purchaseScenario: PurchaseScenario | null = null;

    if (hypotheticalCost !== null && hypotheticalCost !== undefined && hypotheticalCost > 0) {
      const breakeven = calculateBreakevenFloor(hypotheticalCost, feeStructure);

      if (recommendedPrice !== null && recommendedPrice > 0) {
        const proceeds = calculateChannelProceeds(recommendedPrice, hypotheticalCost, feeStructure);
        purchaseScenario = {
          hypotheticalCost,
          targetChannel: feeStructure.channel,
          estimatedSellingPrice: proceeds.sellingPrice,
          estimatedFees: proceeds.totalFees,
          estimatedShipping: proceeds.shippingCost,
          estimatedNetProceeds: proceeds.netProceeds,
          potentialProfit: proceeds.contributionProfit,
          potentialMargin: proceeds.grossMarginPct,
          breakevenPrice: proceeds.breakevenPrice,
          potentialRoi: proceeds.roiPct,
        };
      } else {
        purchaseScenario = {
          hypotheticalCost,
          targetChannel: feeStructure.channel,
          estimatedSellingPrice: null,
          estimatedFees: null,
          estimatedShipping: feeStructure.estimatedShipping,
          estimatedNetProceeds: null,
          potentialProfit: null,
          potentialMargin: null,
          breakevenPrice: breakeven,
          potentialRoi: null,
        };
      }
    }

    // 8. Determine status
    let status: ResearchStatus = "SUCCESS";
    let message = `Research complete with ${observations.length} genuine market observations across ${sources.length} sources.`;

    const allConfigured = providerStatuses.filter(p => p.status !== "NOT_CONFIGURED");

    if (observations.length === 0) {
      if (allConfigured.length === 0 || (providerStatuses.length > 0 && providerStatuses.every(p => p.status === "NOT_CONFIGURED" || p.status === "FAILED"))) {
        status = "EXTERNAL_SOURCE_FAILURE";
        message = "Live market evidence unavailable: configured market providers failed or unconfigured.";
      } else {
        status = "NO_DATA";
        message = `No genuine market evidence found across searched sources for ${product.name} (${canonicalId}).`;
      }
    } else if (observations.length < 2) {
      status = "INSUFFICIENT_DATA";
      message = `Insufficient genuine market observations (${observations.length} found). Minimum 2 required for pricing recommendations.`;
    }

    // 9. Persist lightweight research history
    try {
      await prisma.legoResearchHistory.create({
        data: {
          setNumber: canonicalId,
          identifierType: resolved.identifierType,
          productName: product.name,
          theme: product.theme,
          imageUrl: product.imageUrl,
          recommendedPrice: recommendedPrice !== null ? new Prisma.Decimal(recommendedPrice) : null,
          marketMedian: (metrics.median > 0 && observations.length >= 2) ? new Prisma.Decimal(metrics.median) : null,
          marketMin: (metrics.min > 0 && observations.length >= 2) ? new Prisma.Decimal(metrics.min) : null,
          marketMax: (metrics.max > 0 && observations.length >= 2) ? new Prisma.Decimal(metrics.max) : null,
          observationCount: observations.length,
          confidenceScore: finalConfidenceScore,
          confidenceTier: finalConfidenceTier,
          targetChannel,
          hypotheticalCost: hypotheticalCost ? new Prisma.Decimal(hypotheticalCost) : null,
          potentialMargin: purchaseScenario?.potentialMargin !== null && purchaseScenario?.potentialMargin !== undefined
            ? new Prisma.Decimal(purchaseScenario.potentialMargin)
            : null,
          potentialProfit: purchaseScenario?.potentialProfit !== null && purchaseScenario?.potentialProfit !== undefined
            ? new Prisma.Decimal(purchaseScenario.potentialProfit)
            : null,
          status,
          resolvedMetadataJson: JSON.stringify({
            resolved,
            providerStatuses,
            evidenceByColor: Object.keys(evidenceByColor).length > 0 ? evidenceByColor : undefined,
          }),
          researchedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn("[MarketResearchService] Could not persist research history:", err);
    }

    return {
      productId: product.id,
      setNumber: canonicalId,
      productName: product.name,
      theme: product.theme,
      imageUrl: product.imageUrl,
      ean: product.ean,
      metadataAvailable: metadata.metadataAvailable,
      resolvedProduct: resolved,
      providerStatuses,
      evidenceByColor: Object.keys(evidenceByColor).length > 0 ? evidenceByColor : undefined,
      observationCount: observations.length,
      soldObservationCount: soldCount,
      askingObservationCount: askingCount,
      currentBidObservationCount: bidCount,
      medianPrice: (metrics.median > 0 && observations.length >= 2) ? metrics.median : null,
      meanPrice: (metrics.mean > 0 && observations.length >= 2) ? metrics.mean : null,
      minimumObservedPrice: (metrics.min > 0 && observations.length >= 2) ? metrics.min : null,
      maximumObservedPrice: (metrics.max > 0 && observations.length >= 2) ? metrics.max : null,
      confidenceScore: finalConfidenceScore,
      confidenceTier: finalConfidenceTier,
      recommendedMarketPrice: recommendedPrice,
      currency: "EUR",
      latestObservationAt,
      sources,
      observations,
      status,
      targetChannel,
      purchaseScenario,
      isStale,
      researchTimestamp: new Date(),
      message,
    };
  }

  /**
   * Retrieves the latest unique research history entries.
   */
  static async getRecentResearches(limit: number = 6) {
    try {
      const records = await prisma.legoResearchHistory.findMany({
        orderBy: { researchedAt: "desc" },
        take: limit * 3,
      });

      const seen = new Set<string>();
      const unique = [];
      for (const rec of records) {
        if (!seen.has(rec.setNumber)) {
          seen.add(rec.setNumber);
          unique.push({
            id: rec.id,
            setNumber: rec.setNumber,
            identifierType: rec.identifierType || "LEGO_SET",
            productName: rec.productName,
            theme: rec.theme,
            imageUrl: rec.imageUrl,
            recommendedPrice: rec.recommendedPrice ? Number(rec.recommendedPrice) : null,
            marketMedian: rec.marketMedian ? Number(rec.marketMedian) : null,
            observationCount: rec.observationCount,
            confidenceScore: rec.confidenceScore,
            confidenceTier: rec.confidenceTier || "Unknown",
            targetChannel: rec.targetChannel,
            status: rec.status,
            researchedAt: rec.researchedAt,
            isStale: Date.now() - new Date(rec.researchedAt).getTime() > 6 * 60 * 60 * 1000,
          });
          if (unique.length >= limit) break;
        }
      }
      return unique;
    } catch (err) {
      console.warn("[MarketResearchService] Error fetching recent researches:", err);
      return [];
    }
  }
}

export const normalizeSetNumber = MarketResearchService.normalizeSetNumber;
export const isValidSetNumber = MarketResearchService.isValidSetNumber;
export const resolveProductMetadata = MarketResearchService.resolveProductMetadata;
