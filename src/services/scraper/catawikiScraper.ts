import prisma from "@/lib/prisma";
import { AlertSeverity, AlertType, ObservationProvenance, PriceType } from "@prisma/client";

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
   * Fetches genuine market observations for a given LEGO set number.
   * If APIFY_API_TOKEN is configured, queries the Apify saswave/catawiki-scraper actor.
   * If Apify fails or is unconfigured, returns empty array.
   * Synthetic or simulated data is strictly forbidden across all application runtimes.
   */
  static async fetchMarketObservations(
    setNumber: string,
    _fallbackBaselineCost: number = 100.0,
    maxItems: number = 20
  ): Promise<CatawikiScrapedLot[]> {
    void _fallbackBaselineCost;
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

    // Invariant: Never fabricate market observations in ANY application runtime.
    // Provider unconfigured or returned 0 items -> return empty array.
    if (!apifyToken) {
      console.warn(`[CatawikiScraper] APIFY_API_TOKEN unconfigured for set ${setNumber}. Returning empty market observations.`);
    } else {
      console.warn(`[CatawikiScraper] Apify search returned 0 matching items for set ${setNumber}.`);
    }
    return [];
  }

  /**
   * Validates and parses raw Apify dataset records into structured lots.
   * Strictly verifies set number boundary regex matching and filters malformed observations.
   */
  static parseApifyDataset(items: RawApifyLotItem[], setNumber: string): CatawikiScrapedLot[] {
    const escaped = setNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^0-9A-Za-z])${escaped}(?:[^0-9A-Za-z]|$)`, "i");
    const results: CatawikiScrapedLot[] = [];

    for (const item of items) {
      const title = String(item.title || item.name || "");
      // Exact set number boundary match check
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

      let sellerName: string | undefined = undefined;
      if (typeof item.seller === "object" && item.seller !== null && item.seller.name) {
        sellerName = String(item.seller.name);
      } else if (typeof item.seller === "string" && item.seller.trim().length > 0) {
        sellerName = item.seller.trim();
      }
      if (sellerName && sellerName.toLowerCase().includes("simulated")) {
        sellerName = undefined;
      }

      let externalUrl: string | undefined = undefined;
      const rawUrl = item.url || item.lotUrl || (item.id ? `https://www.catawiki.com/en/l/${item.id}` : undefined);
      if (rawUrl && (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) && !rawUrl.toLowerCase().includes("simulated")) {
        externalUrl = rawUrl;
      }

      results.push({
        externalListingId: String(item.id || item.lotId || `cw-${Date.now()}-${results.length}`),
        title,
        price: numPrice,
        priceType,
        currency: "EUR",
        shippingCost: item.shippingFee || (item.shipping ? parseFloat(String(item.shipping)) : 15.0),
        condition: item.condition?.toUpperCase().includes("SEALED") ? "NEW_SEALED" : "USED_COMPLETE",
        seller: sellerName,
        externalUrl,
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

