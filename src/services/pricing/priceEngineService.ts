import prisma from "@/lib/prisma";
import { AlertSeverity, AlertType, ObservationProvenance, PriceType, Prisma } from "@prisma/client";
import { CatawikiScraperService } from "../scraper/catawikiScraper";
import { getAppMode } from "@/lib/auth";
import {
  MARKETPLACE_FEES,
  MarketplaceFeeStructure,
  calculateBreakevenFloor,
  getFeeStructure
} from "./feeService";

export type ConfidenceTier = "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH";
export {
  MARKETPLACE_FEES,
  type MarketplaceFeeStructure,
  calculateBreakevenFloor,
  getFeeStructure
};

export interface PricingMetrics {
  sampleSize: number;
  rawCount: number;
  median: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  cv: number;
  confidenceScore: number; // 0 - 100
  confidenceTier: ConfidenceTier;
  datePenalized: boolean;
}

export interface RecommendationResult {
  variantId: string;
  sku: string;
  setNumber: string;
  productName: string;
  cost: number | null;
  costBasisStatus: "FULLY_KNOWN" | "PARTIALLY_KNOWN" | "COMPLETELY_UNKNOWN";
  recommendedPrice: number;
  projectedMarginPct: number;
  confidenceScore: number;
  confidenceTier: ConfidenceTier;
  reasoning: string;
  breakevenFloor?: number | null;
  channel: string;
  alertCreated?: string;
  status: "OPTIMAL" | "INSUFFICIENT_DATA" | "BELOW_FLOOR" | "HIGH_MARGIN";
}

export interface EvaluateVariantOptions {
  channel?: string;
  allowSimulated?: boolean;
}

export class PriceEngineService {
  /**
   * Statistical outlier trimming and summary metrics calculation.
   * Confidence score (0-100) penalizes missing/unparseable dates, evaluates sample size,
   * CV spread, and completed vs active bid signals.
   */
  static calculateMetrics(
    prices: number[],
    capturedDates: (Date | null | undefined | string)[] = [],
    priceTypes: (PriceType | string)[] = []
  ): PricingMetrics {
    if (!prices || prices.length === 0) {
      return {
        sampleSize: 0,
        rawCount: 0,
        median: 0,
        mean: 0,
        min: 0,
        max: 0,
        stdDev: 0,
        cv: 1.0,
        confidenceScore: 0,
        confidenceTier: "INSUFFICIENT",
        datePenalized: false,
      };
    }

    const rawCount = prices.length;
    if (rawCount < 2) {
      // Rule: Fewer than 2 observations is strictly INSUFFICIENT evidence
      const singlePrice = prices[0];
      return {
        sampleSize: 1,
        rawCount: 1,
        median: singlePrice,
        mean: singlePrice,
        min: singlePrice,
        max: singlePrice,
        stdDev: 0,
        cv: 0,
        confidenceScore: 0,
        confidenceTier: "INSUFFICIENT",
        datePenalized: false,
      };
    }

    const sorted = [...prices].sort((a, b) => a - b);

    // Outlier trimming: if sample size >= 4, trim highest and lowest value
    let filtered = sorted;
    if (sorted.length >= 4) {
      filtered = sorted.slice(1, -1);
    }

    const count = filtered.length;
    const sum = filtered.reduce((acc, p) => acc + p, 0);
    const mean = Math.round((sum / count) * 100) / 100;

    // Median calculation
    const mid = Math.floor(count / 2);
    const median = count % 2 !== 0
      ? filtered[mid]
      : Math.round(((filtered[mid - 1] + filtered[mid]) / 2) * 100) / 100;

    const min = filtered[0];
    const max = filtered[count - 1];

    // Standard deviation & coefficient of variation
    const variance = filtered.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / count;
    const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;
    const cv = mean > 0 ? stdDev / mean : 1.0;

    // --- Confidence scoring (0 - 100) ---
    // 1. Sample size component (up to 35 pts)
    let samplePts = 0;
    if (rawCount >= 8) samplePts = 35;
    else if (rawCount >= 5) samplePts = 28;
    else if (rawCount >= 3) samplePts = 20;
    else if (rawCount === 2) samplePts = 10;

    // 2. Recency & Date validity component (up to 25 pts)
    let recencyPts = 0;
    let datePenalized = false;
    const now = Date.now();
    let hasMissingOrInvalidDate = false;

    if (capturedDates.length === 0 || capturedDates.length < rawCount) {
      hasMissingOrInvalidDate = true;
    }

    const validTimestamps: number[] = [];
    for (const d of capturedDates) {
      if (!d) {
        hasMissingOrInvalidDate = true;
        continue;
      }
      const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
      if (isNaN(t) || t <= 0) {
        hasMissingOrInvalidDate = true;
      } else {
        validTimestamps.push(t);
      }
    }

    if (hasMissingOrInvalidDate) {
      // Missing or unparseable dates are penalized: -10 pts, 0 recency
      datePenalized = true;
      recencyPts = 0;
    } else if (validTimestamps.length > 0) {
      const newestDate = Math.max(...validTimestamps);
      const ageDays = (now - newestDate) / (1000 * 60 * 60 * 24);
      if (ageDays < 7) recencyPts = 25;
      else if (ageDays < 15) recencyPts = 18;
      else if (ageDays < 30) recencyPts = 10;
      else if (ageDays < 45) recencyPts = 5;
      else recencyPts = 0;
    }

    // 3. Volatility / tight spread component (up to 25 pts)
    let spreadPts = 0;
    if (cv < 0.08) spreadPts = 25;
    else if (cv < 0.15) spreadPts = 18;
    else if (cv < 0.25) spreadPts = 10;
    else spreadPts = 0;

    // 4. Completed vs Active bids component (up to 15 pts)
    let transactionPts = 5; // baseline for active bids / asking prices
    if (priceTypes && priceTypes.length > 0) {
      const soldCount = priceTypes.filter(
        pt => pt === PriceType.SOLD_PRICE || pt === "SOLD_PRICE"
      ).length;
      if (soldCount / priceTypes.length >= 0.5) {
        transactionPts = 15;
      } else if (soldCount > 0) {
        transactionPts = 10;
      }
    }

    let totalScore = samplePts + recencyPts + spreadPts + transactionPts;
    if (datePenalized) {
      totalScore -= 10;
    }
    const rawScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // Map to confidence tiers strictly honoring sample size caps and cap score accordingly
    let confidenceScore = rawScore;
    let confidenceTier: ConfidenceTier = "INSUFFICIENT";
    if (rawCount < 2) {
      confidenceScore = 0;
      confidenceTier = "INSUFFICIENT";
    } else if (rawCount <= 4) {
      // Rule: 2-4 observations: LOW maximum (capped at 40 max)
      confidenceScore = Math.min(rawScore, 40);
      confidenceTier = confidenceScore >= 20 ? "LOW" : "INSUFFICIENT";
    } else if (rawCount < 8) {
      // Rule: 5-7 observations: eligible for MEDIUM, capped below HIGH (max 75)
      confidenceScore = Math.min(rawScore, 75);
      confidenceTier = confidenceScore >= 45 ? "MEDIUM" : "LOW";
    } else {
      // Rule: 8+ observations: eligible for HIGH
      if (confidenceScore >= 80) {
        confidenceTier = "HIGH";
      } else if (confidenceScore >= 50) {
        confidenceTier = "MEDIUM";
      } else {
        confidenceTier = "LOW";
      }
    }

    return {
      sampleSize: count,
      rawCount,
      median,
      mean,
      min,
      max,
      stdDev,
      cv: Math.round(cv * 100) / 100,
      confidenceScore,
      confidenceTier,
      datePenalized,
    };
  }

  /**
   * Generates a price recommendation for a single product variant.
   * Only genuine market observations (LIVE_API, LIVE_SCRAPE, MANUAL, IMPORTED) are queried by default.
   * Handles unknown cost basis truthfully without fabricating 0.00 COGS.
   */
  static async evaluateVariant(
    variantId: string,
    options?: EvaluateVariantOptions
  ): Promise<RecommendationResult | null> {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: true,
        balances: {
          where: { inventoryAccount: { type: "COMPANY" } }
        },
        listings: true
      }
    });

    if (!variant || !variant.product) return null;

    const setNumber = variant.product.setNumber;
    const productName = variant.product.name;
    const companyBalance = variant.balances[0];

    // Truthful cost basis determination:
    // If no known units exist, cost is null (never invent 0.00)
    const knownCostQty = companyBalance?.knownCostQuantity ?? 0;
    const totalQty = companyBalance?.quantity ?? 0;
    const cost: number | null = (knownCostQty > 0 && companyBalance?.averageCost)
      ? Number(companyBalance.averageCost)
      : null;

    let costBasisStatus: "FULLY_KNOWN" | "PARTIALLY_KNOWN" | "COMPLETELY_UNKNOWN" = "COMPLETELY_UNKNOWN";
    if (knownCostQty >= totalQty && totalQty > 0 && cost !== null) {
      costBasisStatus = "FULLY_KNOWN";
    } else if (knownCostQty > 0 && totalQty > 0) {
      costBasisStatus = "PARTIALLY_KNOWN";
    }

    const channel = options?.channel || "DEFAULT";
    const feeStructure = MARKETPLACE_FEES[channel] || MARKETPLACE_FEES.DEFAULT;

    // 1. Query recent observations (last 45 days)
    // Production rule: exclude SIMULATED observations
    const allowedProvenances: ObservationProvenance[] = [
      ObservationProvenance.LIVE_API,
      ObservationProvenance.LIVE_SCRAPE,
      ObservationProvenance.MANUAL,
      ObservationProvenance.IMPORTED,
    ];

    if (options?.allowSimulated && getAppMode() === "demo") {
      allowedProvenances.push(ObservationProvenance.SIMULATED);
    }

    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    let snapshots = await prisma.marketPriceSnapshot.findMany({
      where: {
        productId: variant.productId,
        capturedAt: { gte: fortyFiveDaysAgo },
        provenance: { in: allowedProvenances },
      },
      orderBy: { capturedAt: "desc" }
    });

    // If fewer than 2 genuine observations, trigger fresh scrape
    if (snapshots.length < 2) {
      await CatawikiScraperService.refreshSetPrices(setNumber);
      snapshots = await prisma.marketPriceSnapshot.findMany({
        where: {
          productId: variant.productId,
          capturedAt: { gte: fortyFiveDaysAgo },
          provenance: { in: allowedProvenances },
        },
        orderBy: { capturedAt: "desc" }
      });
    }

    // If STILL fewer than 2 observations, return insufficient evidence state
    if (snapshots.length < 2) {
      const existingAlert = await prisma.alert.findFirst({
        where: {
          productVariantId: variant.id,
          type: AlertType.INSUFFICIENT_MARKET_EVIDENCE,
          resolved: false
        }
      });
      if (!existingAlert) {
        await prisma.alert.create({
          data: {
            productVariantId: variant.id,
            type: AlertType.INSUFFICIENT_MARKET_EVIDENCE,
            severity: AlertSeverity.WARNING,
            message: `Insufficient genuine market observations for Set ${setNumber} (${productName}). Found ${snapshots.length} observation(s); minimum 2 required for reliable pricing.`
          }
        });
      }

      return {
        variantId: variant.id,
        sku: variant.sku,
        setNumber,
        productName,
        cost,
        costBasisStatus,
        recommendedPrice: 0,
        projectedMarginPct: 0,
        confidenceScore: 0,
        confidenceTier: "INSUFFICIENT",
        reasoning: `Insufficient genuine market evidence: only ${snapshots.length} observation(s) available in the last 45 days. Minimum 2 required.`,
        breakevenFloor: null,
        channel,
        alertCreated: "INSUFFICIENT_MARKET_EVIDENCE",
        status: "INSUFFICIENT_DATA"
      };
    }

    const prices = snapshots.map(s => Number(s.price));
    const dates = snapshots.map(s => s.capturedAt);
    const types = snapshots.map(s => s.priceType);
    const metrics = this.calculateMetrics(prices, dates, types);

    if (metrics.median === 0) {
      return null;
    }

    // 2. Financial and Strategy Rules
    const breakevenFloor = calculateBreakevenFloor(cost, feeStructure);

    let recommendedPrice: number;
    let strategyNote: string;
    let alertCreated: string | undefined = undefined;
    let status: "OPTIMAL" | "INSUFFICIENT_DATA" | "BELOW_FLOOR" | "HIGH_MARGIN" = "OPTIMAL";

    if (cost !== null && cost > 0 && breakevenFloor !== null) {
      const netAtMedian = metrics.median * (1 - feeStructure.variableFeePct) - feeStructure.fixedFee - feeStructure.estimatedShipping;
      const minAcceptableNet = cost * 1.10; // Target minimum 10% net profit over cost

      if (netAtMedian < minAcceptableNet) {
        // Enforce breakeven floor + 10% buffer so we never sell at a loss
        recommendedPrice = Math.round(Math.max(breakevenFloor * 1.05, cost * 1.15) * 100) / 100;
        strategyNote = `Market median (€${metrics.median.toFixed(2)}) yields unacceptable margin below cost basis (€${cost.toFixed(2)}). Breakeven floor with fees is €${breakevenFloor.toFixed(2)}. Imposed protective minimum floor at €${recommendedPrice.toFixed(2)}.`;
        status = "BELOW_FLOOR";

        // Trigger UNPROFITABLE_PRICE alert
        const existingAlert = await prisma.alert.findFirst({
          where: {
            productVariantId: variant.id,
            type: AlertType.UNPROFITABLE_PRICE,
            resolved: false
          }
        });
        if (!existingAlert) {
          await prisma.alert.create({
            data: {
              productVariantId: variant.id,
              type: AlertType.UNPROFITABLE_PRICE,
              severity: AlertSeverity.WARNING,
              message: `Market prices for ${setNumber} (${productName}) are near or below cost basis (€${cost.toFixed(2)}). Channel breakeven floor is €${breakevenFloor.toFixed(2)}.`
            }
          });
          alertCreated = "UNPROFITABLE_PRICE";
        }
      } else {
        const projectedMargin = ((metrics.median - cost) / metrics.median) * 100;

        if (projectedMargin > 40.0) {
          // High margin opportunity: price at 98% of median for velocity
          const tentativePrice = Math.round((metrics.median * 0.98) * 100) / 100;
          recommendedPrice = Math.max(breakevenFloor, tentativePrice);
          strategyNote = `High margin opportunity (${projectedMargin.toFixed(1)}%). Positioned at 98% of median (€${metrics.median.toFixed(2)}) for rapid inventory turnover.`;
          status = "HIGH_MARGIN";

          // Trigger PRICE_OPPORTUNITY alert
          const existingAlert = await prisma.alert.findFirst({
            where: {
              productVariantId: variant.id,
              type: AlertType.PRICE_OPPORTUNITY,
              resolved: false
            }
          });
          if (!existingAlert) {
            await prisma.alert.create({
              data: {
                productVariantId: variant.id,
                type: AlertType.PRICE_OPPORTUNITY,
                severity: AlertSeverity.INFO,
                message: `High margin opportunity on ${setNumber} (${projectedMargin.toFixed(1)}% margin at market median €${metrics.median.toFixed(2)}).`
              }
            });
            alertCreated = "PRICE_OPPORTUNITY";
          }
        } else {
          // Balanced competitive positioning: 99% of median
          const tentativePrice = Math.round((metrics.median * 0.99) * 100) / 100;
          recommendedPrice = Math.max(breakevenFloor, tentativePrice);
          strategyNote = `Competitive positioning aligned with market median (€${metrics.median.toFixed(2)}) yielding ${projectedMargin.toFixed(1)}% gross margin.`;
          status = "OPTIMAL";
        }
      }
    } else {
      // Cost is unknown: Price competitively against market median
      recommendedPrice = Math.round((metrics.median * 0.99) * 100) / 100;
      strategyNote = `Cost basis unknown (inventory acquired without documented unit cost). Positioned competitively at 99% of market median (€${metrics.median.toFixed(2)}).`;
      status = "OPTIMAL";
    }

    const finalMarginPct = (cost !== null && cost > 0 && recommendedPrice > 0)
      ? Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10
      : 0;

    const costStr = cost !== null ? `Cost basis: €${cost.toFixed(2)}. ` : "Cost basis: Unknown. ";
    const reasoning = `Based on ${metrics.sampleSize} genuine market observations (Median: €${metrics.median.toFixed(2)}, Spread: €${metrics.min.toFixed(2)} - €${metrics.max.toFixed(2)}, StdDev: ±€${metrics.stdDev.toFixed(2)}). ${costStr}${strategyNote} Confidence: ${metrics.confidenceScore}% (${metrics.confidenceTier}).`;

    // 3. Persist recommendation in DB (only for positive recommendations)
    if (recommendedPrice > 0) {
      const existingRec = await prisma.priceRecommendation.findFirst({
        where: { productVariantId: variant.id }
      });

      if (existingRec) {
        await prisma.priceRecommendation.update({
          where: { id: existingRec.id },
          data: {
            recommendedPrice,
            reasoning,
            confidenceScore: metrics.confidenceScore,
            confidenceTier: metrics.confidenceTier,
            observationCount: metrics.rawCount,
            marketMedian: new Prisma.Decimal(metrics.median),
            marketMin: new Prisma.Decimal(metrics.min),
            marketMax: new Prisma.Decimal(metrics.max),
            evidenceUpdatedAt: new Date(),
            updatedAt: new Date()
          }
        });
      } else {
        await prisma.priceRecommendation.create({
          data: {
            productVariantId: variant.id,
            recommendedPrice,
            reasoning,
            confidenceScore: metrics.confidenceScore,
            confidenceTier: metrics.confidenceTier,
            observationCount: metrics.rawCount,
            marketMedian: new Prisma.Decimal(metrics.median),
            marketMin: new Prisma.Decimal(metrics.min),
            marketMax: new Prisma.Decimal(metrics.max),
            evidenceUpdatedAt: new Date(),
          }
        });
      }
    }

    return {
      variantId: variant.id,
      sku: variant.sku,
      setNumber,
      productName,
      cost,
      costBasisStatus,
      recommendedPrice,
      projectedMarginPct: finalMarginPct,
      confidenceScore: metrics.confidenceScore,
      confidenceTier: metrics.confidenceTier,
      reasoning,
      breakevenFloor,
      channel,
      alertCreated,
      status
    };
  }

  /**
   * Evaluates active variants with company stock and generates fresh price recommendations.
   */
  static async runFullPricingSweep(
    limit: number = 30,
    options?: EvaluateVariantOptions
  ): Promise<{
    processed: number;
    recommendationsCreated: number;
    alertsGenerated: number;
    results: RecommendationResult[];
  }> {
    console.log(`[PriceEngine] Initiating pricing sweep for up to ${limit} inventory items...`);

    const variants = await prisma.productVariant.findMany({
      where: {
        balances: {
          some: {
            inventoryAccount: { type: "COMPANY" },
            quantity: { gt: 0 }
          }
        }
      },
      take: limit,
      include: { product: true }
    });

    let recCount = 0;
    let alertCount = 0;
    const results: RecommendationResult[] = [];

    for (const v of variants) {
      try {
        const res = await this.evaluateVariant(v.id, options);
        if (res) {
          if (res.recommendedPrice > 0) {
            recCount++;
          }
          if (res.alertCreated) alertCount++;
          results.push(res);
        }
      } catch (err) {
        console.error(`[PriceEngine] Error evaluating variant ${v.sku}:`, err);
      }
    }

    console.log(`[PriceEngine] Sweep complete: processed ${variants.length} sets, generated ${recCount} recommendations, ${alertCount} alerts.`);

    return {
      processed: variants.length,
      recommendationsCreated: recCount,
      alertsGenerated: alertCount,
      results
    };
  }
}
