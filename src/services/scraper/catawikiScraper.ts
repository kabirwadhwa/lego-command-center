import prisma from "@/lib/prisma";
import { AlertSeverity, AlertType, ObservationProvenance, PriceType } from "@prisma/client";
import { getAppMode } from "@/lib/auth";

export interface RawApifyLotItem {
  id?: string | number;
  lotId?: string | number;
  title?: string;
  name?: string;
  currentBid?: number | string;
  soldPrice?: number | string;
  price?: number | string;
  bids?: Array<{ amount?: number | string }>;
  currency?: string;
  shippingFee?: number;
  shipping?: number | string;
  condition?: string;
  seller?: string | { name?: string };
  url?: string;
  lotUrl?: string;
  endDate?: string | number;
  isClosed?: boolean;
  status?: string;
  capturedAt?: string | number;
}

export interface CatawikiScrapedLot {
  externalListingId: string;
  title: string;
  price: number;
  priceType: PriceType; // "CURRENT_BID" | "SOLD_PRICE" | "BUY_NOW"
  currency: string;
  shippingCost?: number;
  condition: string;
  seller?: string;
  externalUrl?: string;
  auctionEndAt?: Date;
  capturedAt: Date;
  provenance: ObservationProvenance;
  provider?: string;
  rawMetadataJson?: string;
}

export class CatawikiScraperService {
  /**
   * Fetches market observations for a given LEGO set number.
   * If APIFY_API_TOKEN is configured, queries the Apify saswave/catawiki-scraper actor.
   * IN PRODUCTION: If Apify fails or is unconfigured, returns empty array.
   * SYNTHETIC DATA IS STRICTLY FORBIDDEN FROM PRODUCTION.
   */
  static async fetchMarketObservations(
    setNumber: string,
    fallbackBaselineCost: number = 100.0,
    maxItems: number = 20
  ): Promise<CatawikiScrapedLot[]> {
    const apifyToken = process.env.APIFY_API_TOKEN;

    if (apifyToken) {
      try {
        console.log(`[CatawikiScraper] Querying Apify saswave/catawiki-scraper for set ${setNumber}...`);
        const res = await fetch(
          `https://api.apify.com/v2/acts/saswave~catawiki-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=60`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              searchQueries: [`lego ${setNumber}`],
              maxItems
            })
          }
        );

        if (res.ok) {
          const rawItems = (await res.json()) as RawApifyLotItem[];
          if (Array.isArray(rawItems) && rawItems.length > 0) {
            const parsedLots = this.parseApifyDataset(rawItems, setNumber);
            if (parsedLots.length > 0) {
              console.log(`[CatawikiScraper] Successfully parsed ${parsedLots.length} live lots from Apify.`);
              return parsedLots;
            }
          }
        } else {
          console.warn(`[CatawikiScraper] Apify API returned ${res.status}: ${await res.text()}`);
        }
      } catch (err) {
        console.error(`[CatawikiScraper] Apify call failed:`, err);
      }
    }

    // PRODUCTION RULE: Never fabricate market observations in production runtime
    if (getAppMode() === "production") {
      console.warn(`[CatawikiScraper] Apify unconfigured or scrape returned 0 items for ${setNumber}. Production will not invent synthetic observations.`);
      return [];
    }

    // Explicit non-production demo/testing fixture fallback ONLY
    return this.generateSimulatedObservations(setNumber, fallbackBaselineCost, maxItems);
  }

  /**
   * Validates and parses raw Apify dataset records into structured lots.
   * Strictly verifies set number regex matching and filters malformed observations.
   */
  static parseApifyDataset(items: RawApifyLotItem[], setNumber: string): CatawikiScrapedLot[] {
    const regex = new RegExp(`\\b${setNumber}\\b`, "i");
    const results: CatawikiScrapedLot[] = [];

    for (const item of items) {
      const title = String(item.title || item.name || "");
      // Exact set number match check
      if (!regex.test(title)) continue;

      const rawPrice = item.currentBid || item.soldPrice || item.price || item.bids?.[0]?.amount;
      const numPrice = typeof rawPrice === "number" ? rawPrice : parseFloat(String(rawPrice || "0").replace(/[^0-9.]/g, ""));

      if (numPrice <= 0 || isNaN(numPrice)) continue;

      const isClosed = item.isClosed || item.status === "closed" || Boolean(item.soldPrice);
      const priceType: PriceType = isClosed ? PriceType.SOLD_PRICE : PriceType.CURRENT_BID;

      const currency = item.currency ? item.currency.toUpperCase() : "EUR";
      // Skip non-EUR observations if we cannot reliably convert FX
      if (currency !== "EUR") {
        continue;
      }

      const sellerName = typeof item.seller === "object" && item.seller !== null
        ? item.seller.name || "Catawiki Verified Seller"
        : String(item.seller || "Catawiki Verified Seller");

      results.push({
        externalListingId: String(item.id || item.lotId || `cw-${Date.now()}-${results.length}`),
        title,
        price: numPrice,
        priceType,
        currency: "EUR",
        shippingCost: item.shippingFee || (item.shipping ? parseFloat(String(item.shipping)) : 15.0),
        condition: item.condition?.toUpperCase().includes("SEALED") ? "NEW_SEALED" : "USED_COMPLETE",
        seller: sellerName,
        externalUrl: item.url || item.lotUrl || (item.id ? `https://www.catawiki.com/en/l/${item.id}` : undefined),
        auctionEndAt: item.endDate ? new Date(item.endDate) : undefined,
        capturedAt: item.capturedAt ? new Date(item.capturedAt) : new Date(),
        provenance: ObservationProvenance.LIVE_SCRAPE,
        provider: "apify/saswave/catawiki-scraper",
        rawMetadataJson: JSON.stringify({ rawPrice, isClosed, currency: item.currency })
      });
    }

    return results;
  }

  /**
   * Explicitly labeled simulated observations for unit testing and local demo fixtures ONLY.
   * MUST NOT enter production recommendation calculations.
   */
  static generateSimulatedObservations(
    setNumber: string,
    baselineCost: number,
    count: number = 8
  ): CatawikiScrapedLot[] {
    const cost = baselineCost > 0 ? baselineCost : 80.0;
    const marketMid = Math.round(cost * 1.42 * 100) / 100;
    const now = Date.now();
    const lots: CatawikiScrapedLot[] = [];

    const seed = setNumber.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    for (let i = 0; i < count; i++) {
      const spreadPct = (((seed + i * 17) % 25) - 12) / 100; // -12% to +12%
      const price = Math.round((marketMid * (1 + spreadPct)) * 100) / 100;
      const isSold = i < count - 2;
      const daysAgo = (i * 3) + 1;

      lots.push({
        externalListingId: `simulated-catawiki-lot-${setNumber}-${1000 + i}`,
        title: `[SIMULATED] LEGO Set ${setNumber} Lot #${1000 + i}`,
        price,
        priceType: isSold ? PriceType.SOLD_PRICE : PriceType.CURRENT_BID,
        currency: "EUR",
        shippingCost: 14.50,
        condition: "NEW_SEALED",
        seller: `Simulated Seller #${(seed + i) % 90 + 10}`,
        externalUrl: `https://www.catawiki.com/en/l/simulated-${setNumber}-${1000 + i}`,
        auctionEndAt: isSold ? new Date(now - daysAgo * 86400000) : new Date(now + 2 * 86400000),
        capturedAt: new Date(now - daysAgo * 86400000),
        provenance: ObservationProvenance.SIMULATED,
        provider: "simulator/demo"
      });
    }

    return lots;
  }

  /**
   * Refreshes and persists observations for a specific product set number.
   * Records explicit provenance and creates alerts when evidence is missing.
   */
  static async refreshSetPrices(setNumber: string): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      const product = await prisma.product.findUnique({
        where: { setNumber },
        include: {
          variants: {
            include: {
              balances: {
                where: { inventoryAccount: { type: "COMPANY" } }
              }
            }
          }
        }
      });

      if (!product) {
        return { success: false, count: 0, error: `Product set ${setNumber} not found.` };
      }

      const variant = product.variants[0];
      const balance = variant?.balances?.[0];
      const baselineCost = balance?.averageCost ? Number(balance.averageCost) : 100.0;

      const observations = await this.fetchMarketObservations(setNumber, baselineCost);

      if (observations.length === 0) {
        if (variant) {
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
                message: `Live market observations unavailable for set ${setNumber} (${product.name}). Apify scraper unconfigured or returned no matching lots.`
              }
            });
          }
        }
        return {
          success: false,
          count: 0,
          error: "Live market evidence unavailable or Apify unconfigured."
        };
      }

      let savedCount = 0;
      for (const obs of observations) {
        const existing = await prisma.marketPriceSnapshot.findFirst({
          where: {
            productId: product.id,
            externalListingId: obs.externalListingId
          }
        });

        if (!existing) {
          await prisma.marketPriceSnapshot.create({
            data: {
              productId: product.id,
              marketplace: "CATAWIKI",
              price: obs.price,
              priceType: obs.priceType,
              currency: obs.currency,
              shipping: obs.shippingCost,
              condition: obs.condition,
              seller: obs.seller,
              externalListingId: obs.externalListingId,
              externalUrl: obs.externalUrl,
              auctionEndAt: obs.auctionEndAt,
              capturedAt: obs.capturedAt,
              availability: true,
              provenance: obs.provenance,
              provider: obs.provider,
              rawMetadataJson: obs.rawMetadataJson
            }
          });
          savedCount++;
        }
      }

      return { success: true, count: savedCount };
    } catch (err) {
      console.error(`Failed to refresh Catawiki prices for ${setNumber}:`, err);
      return { success: false, count: 0, error: err instanceof Error ? err.message : "Scraper error" };
    }
  }
}

