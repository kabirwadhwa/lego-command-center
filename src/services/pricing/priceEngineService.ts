import prisma from "@/lib/prisma";
import { AlertSeverity, AlertType, PriceType } from "@prisma/client";
import { CatawikiScraperService } from "../scraper/catawikiScraper";

export interface PricingMetrics {
  sampleSize: number;
  rawCount: number;
  median: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  confidenceScore: number; // 0 - 100
}

export interface RecommendationResult {
  variantId: string;
  sku: string;
  setNumber: string;
  productName: string;
  cost: number;
  recommendedPrice: number;
  projectedMarginPct: number;
  confidenceScore: number;
  reasoning: string;
  alertCreated?: string;
}

export class PriceEngineService {
  /**
   * Statistical outlier trimming and summary metrics calculation.
   */
  static calculateMetrics(prices: number[], capturedDates: Date[] = []): PricingMetrics {
    if (!prices || prices.length === 0) {
      return {
        sampleSize: 0,
        rawCount: 0,
        median: 0,
        mean: 0,
        min: 0,
        max: 0,
        stdDev: 0,
        confidenceScore: 0
      };
    }

    const rawCount = prices.length;
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

    // Standard deviation
    const variance = filtered.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / count;
    const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;
    const cv = mean > 0 ? stdDev / mean : 1.0;

    // Confidence scoring (0 - 100)
    let confidence = 0;
    // 1. Sample size component (up to 50 pts)
    if (rawCount >= 8) confidence += 50;
    else if (rawCount >= 5) confidence += 40;
    else if (rawCount >= 3) confidence += 25;
    else confidence += 10;

    // 2. Recency component (up to 30 pts)
    const now = Date.now();
    const newestDate = capturedDates.length > 0
      ? Math.max(...capturedDates.map(d => d.getTime()))
      : now;
    const ageDays = (now - newestDate) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) confidence += 30;
    else if (ageDays < 15) confidence += 20;
    else if (ageDays < 30) confidence += 10;
    else confidence += 5;

    // 3. Volatility / tight spread component (up to 20 pts)
    if (cv < 0.10) confidence += 20;
    else if (cv < 0.20) confidence += 10;
    else confidence += 5;

    return {
      sampleSize: count,
      rawCount,
      median,
      mean,
      min,
      max,
      stdDev,
      confidenceScore: Math.min(100, confidence)
    };
  }

  /**
   * Generates a price recommendation for a single product variant.
   */
  static async evaluateVariant(variantId: string): Promise<RecommendationResult | null> {
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
    const cost = companyBalance?.averageCost ? Number(companyBalance.averageCost) : 0;

    // 1. Query recent observations (last 45 days)
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    let snapshots = await prisma.marketPriceSnapshot.findMany({
      where: {
        productId: variant.productId,
        capturedAt: { gte: fortyFiveDaysAgo }
      },
      orderBy: { capturedAt: "desc" }
    });

    // If no recent observations, run scraper to collect fresh data
    if (snapshots.length === 0) {
      await CatawikiScraperService.refreshSetPrices(setNumber);
      snapshots = await prisma.marketPriceSnapshot.findMany({
        where: {
          productId: variant.productId,
          capturedAt: { gte: fortyFiveDaysAgo }
        },
        orderBy: { capturedAt: "desc" }
      });
    }

    const prices = snapshots.map(s => Number(s.price));
    const dates = snapshots.map(s => s.capturedAt);
    const metrics = this.calculateMetrics(prices, dates);

    if (metrics.median === 0) {
      return null;
    }

    // 2. Financial and Strategy Rules
    // Assume 15% combined platform and payment processing fee
    const platformFeeRate = 0.15;
    const breakevenFloor = cost > 0 ? Math.round((cost / (1 - platformFeeRate)) * 100) / 100 : 0;

    let recommendedPrice: number;
    let strategyNote: string;
    let alertCreated: string | undefined = undefined;

    const medianNet = metrics.median * (1 - platformFeeRate);
    const projectedMargin = cost > 0 ? ((metrics.median - cost) / metrics.median) * 100 : 35.0;

    if (cost > 0 && medianNet < cost * 1.10) {
      // Unprofitable or razor-thin margin: enforce minimum 15% net margin floor
      recommendedPrice = Math.round((cost * 1.18) * 100) / 100;
      strategyNote = `Market median (€${metrics.median.toFixed(2)}) yields unacceptable margin below cost basis. Imposed minimum floor price at €${recommendedPrice.toFixed(2)}.`;

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
            message: `Market prices for ${setNumber} (${productName}) are near or below cost basis (€${cost.toFixed(2)}).`
          }
        });
        alertCreated = "UNPROFITABLE_PRICE";
      }
    } else if (projectedMargin > 40.0) {
      // High margin opportunity: price competitively at 98% of median for rapid turnover
      recommendedPrice = Math.round((metrics.median * 0.98) * 100) / 100;
      strategyNote = `Exceptional margin opportunity (${projectedMargin.toFixed(1)}%). Positioned at 98% of median (€${metrics.median.toFixed(2)}) for maximum sales velocity.`;

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
      // Balanced competitive positioning
      recommendedPrice = Math.round((metrics.median * 0.99) * 100) / 100;
      strategyNote = `Competitive positioning aligned with market median (€${metrics.median.toFixed(2)}) yielding stable ${projectedMargin.toFixed(1)}% gross margin.`;
    }

    const finalMarginPct = recommendedPrice > 0 && cost > 0
      ? Math.round(((recommendedPrice - cost) / recommendedPrice) * 1000) / 10
      : 30.0;

    const reasoning = `Based on ${metrics.sampleSize} recent Catawiki auction observations (Median: €${metrics.median.toFixed(2)}, Spread: €${metrics.min.toFixed(2)} - €${metrics.max.toFixed(2)}, StdDev: ±€${metrics.stdDev.toFixed(2)}). ${cost > 0 ? `Cost basis: €${cost.toFixed(2)}. ` : ""}${strategyNote} Confidence score: ${metrics.confidenceScore}%.`;

    // 3. Persist recommendation
    const existingRec = await prisma.priceRecommendation.findFirst({
      where: { productVariantId: variant.id }
    });

    if (existingRec) {
      await prisma.priceRecommendation.update({
        where: { id: existingRec.id },
        data: {
          recommendedPrice,
          reasoning,
          updatedAt: new Date()
        }
      });
    } else {
      await prisma.priceRecommendation.create({
        data: {
          productVariantId: variant.id,
          recommendedPrice,
          reasoning
        }
      });
    }

    return {
      variantId: variant.id,
      sku: variant.sku,
      setNumber,
      productName,
      cost,
      recommendedPrice,
      projectedMarginPct: finalMarginPct,
      confidenceScore: metrics.confidenceScore,
      reasoning,
      alertCreated
    };
  }

  /**
   * Evaluates all active variants with stock and generates fresh price recommendations.
   */
  static async runFullPricingSweep(limit: number = 30): Promise<{
    processed: number;
    recommendationsCreated: number;
    alertsGenerated: number;
    results: RecommendationResult[];
  }> {
    console.log(`[PriceEngine] Initiating pricing sweep for up to ${limit} inventory items...`);

    // Prioritize variants that have Company inventory balance > 0
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
        const res = await this.evaluateVariant(v.id);
        if (res) {
          recCount++;
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
