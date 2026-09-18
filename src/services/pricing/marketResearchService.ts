import prisma from "@/lib/prisma";
import { ObservationProvenance, PriceType, Prisma } from "@prisma/client";
import { CatawikiScraperService, CatawikiScrapedLot } from "../scraper/catawikiScraper";
import { PriceEngineService, ConfidenceTier } from "./priceEngineService";
import {
  getFeeStructure,
  calculateBreakevenFloor,
  calculateChannelProceeds
} from "./feeService";
import {
  isEligibleForRealMarketPricing,
  GENUINE_PROVENANCES,
  isGenuineListingUrl
} from "./evidenceEligibility";
import fs from "fs";
import path from "path";

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

// In-memory cache for local inventory-seed catalog
let catalogCache: Map<string, { setName: string }> | null = null;

function getCatalogCache(): Map<string, { setName: string }> {
  if (catalogCache) return catalogCache;
  catalogCache = new Map();
  try {
    const seedPath = path.join(process.cwd(), "prisma", "inventory-seed.json");
    if (fs.existsSync(seedPath)) {
      const raw = fs.readFileSync(seedPath, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item.setNumber && item.setName && !catalogCache.has(item.setNumber)) {
            catalogCache.set(String(item.setNumber), { setName: item.setName });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[MarketResearchService] Could not load inventory-seed catalog:", err);
  }
  return catalogCache;
}

export class MarketResearchService {
  /**
   * Normalizes LEGO set number input.
   * Strips whitespace, removes trailing "-1" (BrickLink/Rebrickable variant notation),
   * and verifies character validity.
   */
  static normalizeSetNumber(input: string): string {
    if (!input) return "";
    let normalized = input.trim();
    // Strip common prefixes like "SET-", "SET ", "LEGO-", "LEGO ", "LGO-", "LGO "
    normalized = normalized.replace(/^(?:LEGO|SET|LGO)[-_\s]+/i, "");
    // Strip trailing "-1" or "-2"
    normalized = normalized.replace(/-[0-9]+$/, "");
    return normalized.toUpperCase().trim();
  }

  /**
   * Validates format of LEGO set numbers (usually 3 to 7 digits, or special prefixes).
   */
  static isValidSetNumber(setNumber: string): boolean {
    if (!setNumber || setNumber.length < 3 || setNumber.length > 10) return false;
    return /^[0-9A-Z-]+$/i.test(setNumber);
  }

  /**
   * Resolves LEGO set metadata without fabricating information.
   * Checks Product database first, then local catalog seed.
   */
  static async resolveProductMetadata(
    setNumber: string,
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
  }> {
    // 1. Search existing Product table
    const existing = await prisma.product.findUnique({
      where: { setNumber }
    });

    if (existing) {
      return {
        id: existing.id,
        setNumber: existing.setNumber,
        name: existing.name,
        theme: existing.theme || null,
        imageUrl: existing.imageUrl || null,
        ean: existing.ean || null,
        metadataAvailable: true
      };
    }

    // 2. Check local catalog seed
    const catalog = getCatalogCache();
    const seedInfo = catalog.get(setNumber);
    if (seedInfo) {
      return {
        setNumber,
        name: seedInfo.setName,
        theme: userProvidedTheme || "Icons / General",
        imageUrl: null,
        ean: null,
        metadataAvailable: true
      };
    }

    // 3. User entered custom name
    if (userProvidedName && userProvidedName.trim().length > 0) {
      return {
        setNumber,
        name: userProvidedName.trim(),
        theme: userProvidedTheme ? userProvidedTheme.trim() : null,
        imageUrl: null,
        ean: null,
        metadataAvailable: true
      };
    }

    // 4. Metadata unavailable truthfully
    return {
      setNumber,
      name: "Product metadata unavailable",
      theme: null,
      imageUrl: null,
      ean: null,
      metadataAvailable: false
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
  }) {
    const existing = await prisma.product.findUnique({
      where: { setNumber: metadata.setNumber }
    });

    if (existing) return existing;

    return await prisma.product.create({
      data: {
        setNumber: metadata.setNumber,
        name: metadata.name,
        theme: metadata.theme || "General",
        imageUrl: metadata.imageUrl || null,
        ean: metadata.ean || null,
        status: "ACTIVE"
      }
    });
  }

  /**
   * Fetches genuine market observations adhering to 6-hour freshness and strict provenance.
   * Never uses synthetic/simulated observations in production.
   */
  static async getMarketObservations(
    productId: string,
    setNumber: string,
    forceRefresh: boolean = false
  ): Promise<{
    observations: PricingResearchObservation[];
    isStale: boolean;
    sourceError?: string;
  }> {
    // Invariant: strictly genuine provenances across all environments and runtimes
    const allowedProvenances: ObservationProvenance[] = [...GENUINE_PROVENANCES];

    // Check existing stored snapshots
    const existingSnapshotsRaw = await prisma.marketPriceSnapshot.findMany({
      where: {
        productId,
        provenance: { in: allowedProvenances }
      },
      orderBy: { capturedAt: "desc" }
    });
    const existingSnapshots = existingSnapshotsRaw.filter(isEligibleForRealMarketPricing);

    const now = Date.now();
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    let newestCapturedAt = 0;
    if (existingSnapshots.length > 0) {
      newestCapturedAt = existingSnapshots[0].capturedAt.getTime();
    }

    const isFresh = existingSnapshots.length > 0 && (now - newestCapturedAt) <= SIX_HOURS_MS;

    // Return cached if fresh and not force-refreshing
    if (existingSnapshots.length > 0 && isFresh && !forceRefresh) {
      return {
        observations: existingSnapshots.map(s => this.mapSnapshotToObservation(s)),
        isStale: false
      };
    }

    // If stale but NOT force-refreshing, return cached with stale indicator
    if (existingSnapshots.length > 0 && !forceRefresh) {
      return {
        observations: existingSnapshots.map(s => this.mapSnapshotToObservation(s)),
        isStale: true
      };
    }

    // Fetch fresh observations from Catawiki scraper
    let scraperLots: CatawikiScrapedLot[] = [];
    let sourceError: string | undefined;

    try {
      scraperLots = await CatawikiScraperService.fetchMarketObservations(setNumber);
    } catch (err) {
      console.error(`[MarketResearchService] Catawiki scraper error:`, err);
      sourceError = err instanceof Error ? err.message : "Catawiki scraper request failed";
    }

    // Invariant: unconditionally filter lots through isEligibleForRealMarketPricing
    const validLots = scraperLots.filter(isEligibleForRealMarketPricing);

    // Save newly scraped valid lots to database
    for (const lot of validLots) {
      const existing = await prisma.marketPriceSnapshot.findFirst({
        where: {
          productId,
          externalListingId: lot.externalListingId
        }
      });

      if (!existing) {
        await prisma.marketPriceSnapshot.create({
          data: {
            productId,
            marketplace: "CATAWIKI",
            price: new Prisma.Decimal(lot.price),
            priceType: lot.priceType,
            currency: lot.currency,
            shipping: lot.shippingCost !== undefined ? new Prisma.Decimal(lot.shippingCost) : null,
            condition: lot.condition,
            seller: lot.seller,
            externalListingId: lot.externalListingId,
            externalUrl: lot.externalUrl,
            auctionEndAt: lot.auctionEndAt,
            capturedAt: lot.capturedAt,
            availability: true,
            provenance: lot.provenance,
            provider: lot.provider || "apify/saswave/catawiki-scraper",
            rawMetadataJson: lot.rawMetadataJson
          }
        });
      }
    }

    // Re-query all valid snapshots
    const allSnapshotsRaw = await prisma.marketPriceSnapshot.findMany({
      where: {
        productId,
        provenance: { in: allowedProvenances }
      },
      orderBy: { capturedAt: "desc" }
    });
    const allSnapshots = allSnapshotsRaw.filter(isEligibleForRealMarketPricing);

    return {
      observations: allSnapshots.map(s => this.mapSnapshotToObservation(s)),
      isStale: false,
      sourceError: validLots.length === 0 && sourceError ? sourceError : undefined
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
  }): PricingResearchObservation {
    const rawSeller = snapshot.seller?.trim();
    const seller = (rawSeller && !rawSeller.toLowerCase().includes("simulated")) ? rawSeller : null;
    const url = (snapshot.externalUrl && isGenuineListingUrl(snapshot.externalUrl)) ? snapshot.externalUrl : null;

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
      availability: snapshot.availability
    };
  }

  /**
   * Executes a complete manual market research operation for ANY LEGO set number.
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
      userTheme
    } = params;

    const normalizedSetNumber = this.normalizeSetNumber(params.setNumber);
    if (!this.isValidSetNumber(normalizedSetNumber)) {
      return {
        setNumber: params.setNumber,
        productName: "Invalid Set Number",
        metadataAvailable: false,
        observationCount: 0,
        soldObservationCount: 0,
        askingObservationCount: 0,
        currentBidObservationCount: 0,
        medianPrice: null,
        meanPrice: null,
        minimumObservedPrice: null,
        maximumObservedPrice: null,
        confidenceScore: null,
        confidenceTier: "INSUFFICIENT",
        recommendedMarketPrice: null,
        currency: "EUR",
        latestObservationAt: null,
        sources: [],
        observations: [],
        status: "NO_DATA",
        targetChannel,
        researchTimestamp: new Date(),
        message: "Invalid LEGO set number. Please enter a valid 3 to 7 digit set number (e.g. 10316)."
      };
    }

    // 1. Resolve product metadata
    const metadata = await this.resolveProductMetadata(
      normalizedSetNumber,
      userProductName,
      userTheme
    );

    // 2. Ensure a catalog Product record exists (zero inventory, no variants created)
    const product = await this.ensureCatalogProduct({
      setNumber: normalizedSetNumber,
      name: metadata.name,
      theme: metadata.theme,
      imageUrl: metadata.imageUrl,
      ean: metadata.ean
    });

    // 3. Get market observations
    const { observations: rawObservations, isStale, sourceError } = await this.getMarketObservations(
      product.id,
      normalizedSetNumber,
      forceRefresh
    );
    const observations = rawObservations.filter(isEligibleForRealMarketPricing);

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

    // 4. Calculate statistical metrics
    const metrics = PriceEngineService.calculateMetrics(prices, capturedDates, priceTypes);

    // 5. Determine recommended market price
    // Invariant: strictly requires >= 2 genuine market observations
    let recommendedPrice: number | null = null;
    if (metrics.median > 0 && observations.length >= 2) {
      recommendedPrice = Math.round((metrics.median * 0.99) * 100) / 100;
    }

    // 6. Fee structure and hypothetical scenario
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
          potentialRoi: proceeds.roiPct
        };
      } else {
        // When genuine market observations < 2, never fabricate selling price, profit, margin or ROI
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
          potentialRoi: null
        };
      }
    }

    // 7. Determine status
    let status: ResearchStatus = "SUCCESS";
    let message = "Research complete with live market observations.";

    if (observations.length === 0) {
      if (sourceError || !process.env.APIFY_API_TOKEN) {
        status = "EXTERNAL_SOURCE_FAILURE";
        message = "Live market evidence unavailable: external price source unconfigured or failed.";
      } else {
        status = "NO_DATA";
        message = `No sufficient live market evidence was found for LEGO Set ${normalizedSetNumber}.`;
      }
    } else if (observations.length < 2) {
      status = "INSUFFICIENT_DATA";
      message = `Insufficient live market observations (${observations.length} found). Minimum 2 required for reliable pricing.`;
    }

    // 8. Persist lightweight research history
    try {
      await prisma.legoResearchHistory.create({
        data: {
          setNumber: normalizedSetNumber,
          productName: product.name,
          theme: product.theme,
          imageUrl: product.imageUrl,
          recommendedPrice: recommendedPrice !== null ? new Prisma.Decimal(recommendedPrice) : null,
          marketMedian: (metrics.median > 0 && observations.length >= 2) ? new Prisma.Decimal(metrics.median) : null,
          marketMin: (metrics.min > 0 && observations.length >= 2) ? new Prisma.Decimal(metrics.min) : null,
          marketMax: (metrics.max > 0 && observations.length >= 2) ? new Prisma.Decimal(metrics.max) : null,
          observationCount: observations.length,
          confidenceScore: (metrics.confidenceScore > 0 && observations.length >= 2) ? metrics.confidenceScore : null,
          confidenceTier: observations.length < 2 ? "INSUFFICIENT" : metrics.confidenceTier,
          targetChannel,
          hypotheticalCost: hypotheticalCost ? new Prisma.Decimal(hypotheticalCost) : null,
          potentialMargin: (purchaseScenario?.potentialMargin !== null && purchaseScenario?.potentialMargin !== undefined) ? new Prisma.Decimal(purchaseScenario.potentialMargin) : null,
          potentialProfit: (purchaseScenario?.potentialProfit !== null && purchaseScenario?.potentialProfit !== undefined) ? new Prisma.Decimal(purchaseScenario.potentialProfit) : null,
          status,
          researchedAt: new Date()
        }
      });
    } catch (err) {
      console.warn("[MarketResearchService] Could not persist research history:", err);
    }

    return {
      productId: product.id,
      setNumber: normalizedSetNumber,
      productName: product.name,
      theme: product.theme,
      imageUrl: product.imageUrl,
      ean: product.ean,
      metadataAvailable: metadata.metadataAvailable,
      observationCount: observations.length,
      soldObservationCount: soldCount,
      askingObservationCount: askingCount,
      currentBidObservationCount: bidCount,
      medianPrice: (metrics.median > 0 && observations.length >= 2) ? metrics.median : null,
      meanPrice: (metrics.mean > 0 && observations.length >= 2) ? metrics.mean : null,
      minimumObservedPrice: (metrics.min > 0 && observations.length >= 2) ? metrics.min : null,
      maximumObservedPrice: (metrics.max > 0 && observations.length >= 2) ? metrics.max : null,
      confidenceScore: (metrics.confidenceScore > 0 && observations.length >= 2) ? metrics.confidenceScore : null,
      confidenceTier: observations.length < 2 ? "INSUFFICIENT" : metrics.confidenceTier,
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
      message
    };
  }

  /**
   * Retrieves the latest unique research history entries.
   */
  static async getRecentResearches(limit: number = 6) {
    try {
      const records = await prisma.legoResearchHistory.findMany({
        orderBy: { researchedAt: "desc" },
        take: limit * 3
      });

      // Distinct by setNumber preserving newest
      const seen = new Set<string>();
      const unique = [];
      for (const rec of records) {
        if (!seen.has(rec.setNumber)) {
          seen.add(rec.setNumber);
          unique.push({
            id: rec.id,
            setNumber: rec.setNumber,
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
            isStale: Date.now() - new Date(rec.researchedAt).getTime() > 6 * 60 * 60 * 1000
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
