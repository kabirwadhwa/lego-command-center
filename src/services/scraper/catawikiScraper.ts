import prisma from "@/lib/prisma";
import { AlertSeverity, AlertType, ObservationProvenance, PriceType } from "@prisma/client";
import {
  CatawikiDiagnosticStatus,
  CatawikiRejectionReason,
} from "@/services/pricing/providers/types";
import { EvidenceValidator } from "@/services/pricing/providers/evidenceValidator";

export interface RawApifyLotItem {
  id?: string | number;
  lot_id?: string | number;
  lotId?: string | number;
  title?: string;
  name?: string;
  subtitle?: string;
  current_bid?: number | string;
  currentBid?: number | string | { EUR?: number; USD?: number; GBP?: number; [k: string]: unknown };
  currentBidValue?: number | string;
  currentBidCurrency?: string;
  buyNow?: { EUR?: number; USD?: number; GBP?: number; [k: string]: unknown } | null;
  buyNowValue?: number | string;
  sold_price?: number | string;
  soldPrice?: number | string;
  price?: number | string;
  bids?: Array<{ amount?: number | string }>;
  currency?: string;
  shipping_fee?: number | string;
  shippingFee?: number;
  shipping?: number | string;
  condition?: string;
  seller?: string | { name?: string; username?: string };
  sellerShopName?: string;
  sellerUserName?: string;
  sellerCountry?: string;
  url?: string;
  lot_url?: string;
  lotUrl?: string;
  end_date?: string | number;
  endDate?: string | number;
  biddingEndTime?: string | number;
  biddingStartTime?: string | number;
  is_closed?: boolean;
  isClosed?: boolean;
  closeStatus?: string;
  status?: string;
  captured_at?: string | number;
  capturedAt?: string | number;
  [key: string]: unknown;
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

export interface CatawikiScraperTelemetry {
  configured: boolean;
  provider: string;
  actor: string;
  requestExecuted: boolean;
  requestSuccessful: boolean;
  responseStatus: number | null;
  queriesAttempted: string[];
  urlsAttempted: string[];
  rawResultCount: number;
  acceptedResultCount: number;
  rejectedResultCount: number;
  rejectionReasonCounts: Record<CatawikiRejectionReason, number>;
  rejectionDetails: Array<{ title?: string; url?: string; reason: CatawikiRejectionReason; detail?: string }>;
  durationMs: number;
  status: CatawikiDiagnosticStatus;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Builds intelligent search queries for Catawiki based on LEGO product type and name.
 */
export function buildCatawikiSearchQueries(
  identifier: string,
  product?: { name?: string | null; identifierType?: string }
): string[] {
  const cleanId = identifier.trim();
  const queries: string[] = [];
  const type = product?.identifierType;
  const rawName = product?.name;
  const hasValidName = rawName && rawName !== "Product metadata unavailable" && rawName !== "Unknown";
  const name = hasValidName ? rawName.trim() : null;

  if (type === "LEGO_PART") {
    queries.push(`LEGO ${cleanId}`);
    queries.push(`LEGO part ${cleanId}`);
    if (name) {
      queries.push(`LEGO ${cleanId} ${name}`);
    }
  } else if (type === "LEGO_SET") {
    queries.push(`LEGO ${cleanId}`);
    if (name) {
      queries.push(`LEGO ${cleanId} ${name}`);
      if (!name.toLowerCase().includes(cleanId.toLowerCase())) {
        queries.push(`LEGO ${name} ${cleanId}`);
      }
    }
  } else {
    // Unknown or unclassified: raw input search queries
    queries.push(`LEGO ${cleanId}`);
    if (name) {
      queries.push(`LEGO ${cleanId} ${name}`);
    }
  }

  // Deduplicate and limit to 2 query variants to prevent excessive latency / Apify costs
  return Array.from(new Set(queries)).slice(0, 2);
}

/**
 * Robust numeric price parser supporting European formats (149,50 or 1.250,00).
 */
export function parseCatawikiPrice(raw: unknown): number {
  if (typeof raw === "number") return isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  let str = String(raw).trim();
  str = str.replace(/[^\d.,]/g, "");

  if (str.includes(".") && str.includes(",")) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      // 1.250,50 -> 1250.50
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,250.50 -> 1250.50
      str = str.replace(/,/g, "");
    }
  } else if (str.includes(",")) {
    const parts = str.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // 149,50 -> 149.50
      str = `${parts[0]}.${parts[1]}`;
    } else {
      str = str.replace(/,/g, "");
    }
  }

  const val = parseFloat(str);
  return isNaN(val) ? 0 : val;
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
    maxItems: number = 20,
    searchQueries?: string[]
  ): Promise<CatawikiScrapedLot[]> {
    void _fallbackBaselineCost;
    const res = await this.fetchMarketObservationsWithTelemetry({
      identifier: setNumber,
      queries: searchQueries,
      maxItems,
    });
    return res.lots;
  }

  /**
   * Complete runtime execution with structured diagnostic telemetry.
   */
  static async fetchMarketObservationsWithTelemetry(params: {
    identifier: string;
    productName?: string | null;
    identifierType?: string;
    queries?: string[];
    maxItems?: number;
  }): Promise<{ lots: CatawikiScrapedLot[]; telemetry: CatawikiScraperTelemetry }> {
    const cleanId = params.identifier.trim();
    const actorId = process.env.APIFY_ACTOR_ID || "solidcode~catawiki-scraper";
    const apifyToken = process.env.APIFY_API_TOKEN;

    const queries = params.queries && params.queries.length > 0
      ? params.queries
      : buildCatawikiSearchQueries(cleanId, {
          name: params.productName,
          identifierType: params.identifierType,
        });

    const searchUrls = queries.map(q => `https://www.catawiki.com/en/search?q=${encodeURIComponent(q)}`);

    const telemetry: CatawikiScraperTelemetry = {
      configured: Boolean(apifyToken),
      provider: "catawiki",
      actor: actorId,
      requestExecuted: false,
      requestSuccessful: false,
      responseStatus: null,
      queriesAttempted: queries,
      urlsAttempted: searchUrls,
      rawResultCount: 0,
      acceptedResultCount: 0,
      rejectedResultCount: 0,
      rejectionReasonCounts: {
        IDENTIFIER_MISMATCH: 0,
        INVALID_PRICE: 0,
        INVALID_URL: 0,
        CURRENCY_UNSUPPORTED: 0,
        DUPLICATE: 0,
        MISSING_REQUIRED_DATA: 0,
        CONDITION_MISMATCH: 0,
      },
      rejectionDetails: [],
      durationMs: 0,
      status: "NOT_CONFIGURED",
    };

    if (!apifyToken) {
      telemetry.status = "NOT_CONFIGURED";
      telemetry.errorMessage = "Catawiki scraper unconfigured: APIFY_API_TOKEN environment variable is missing.";
      console.warn(`[CatawikiScraper] APIFY_API_TOKEN unconfigured for set ${cleanId}. Returning empty market observations.`);
      return { lots: [], telemetry };
    }

    const startTime = Date.now();
    telemetry.requestExecuted = true;

    // Log safely without token
    console.log(`[CatawikiScraper] provider=CATAWIKI actor=${actorId} query="${cleanId}" queries=[${queries.join(", ")}] request started`);

    try {
      const isSolidCode = actorId.toLowerCase().includes("solidcode");
      const requestBody = isSolidCode
        ? {
            searchQueries: queries,
            maxResults: params.maxItems || 20,
            language: "en",
          }
        : {
            urls: searchUrls,
            max_page: 1,
          };

      const res = await fetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${apifyToken}&timeout=90`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      telemetry.durationMs = Date.now() - startTime;
      telemetry.responseStatus = res.status;

      if (res.status === 401 || res.status === 403) {
        telemetry.status = "AUTH_FAILED";
        telemetry.errorCode = `HTTP_${res.status}`;
        telemetry.errorMessage = "Apify authentication failed. Invalid APIFY_API_TOKEN.";
        console.warn(`[CatawikiScraper] Apify authentication failed (HTTP ${res.status}).`);
        return { lots: [], telemetry };
      }

      if (res.status === 408 || res.status === 504) {
        telemetry.status = "TIMEOUT";
        telemetry.errorCode = "TIMEOUT";
        telemetry.errorMessage = "Apify scraper request timed out after 90 seconds.";
        console.warn(`[CatawikiScraper] Apify scraper timed out for ${cleanId}.`);
        return { lots: [], telemetry };
      }

      if (!res.ok) {
        telemetry.status = "PROVIDER_FAILED";
        telemetry.errorCode = `HTTP_${res.status}`;
        telemetry.errorMessage = `Apify API returned HTTP ${res.status}: ${await res.text().catch(() => "")}`;
        console.warn(`[CatawikiScraper] Apify API error: HTTP ${res.status}`);
        return { lots: [], telemetry };
      }

      telemetry.requestSuccessful = true;
      const rawItems = (await res.json()) as RawApifyLotItem[];

      if (!Array.isArray(rawItems)) {
        telemetry.status = "PARSE_FAILED";
        telemetry.errorCode = "INVALID_RESPONSE_FORMAT";
        telemetry.errorMessage = "Apify response was not a JSON array of items.";
        return { lots: [], telemetry };
      }

      telemetry.rawResultCount = rawItems.length;

      if (rawItems.length === 0) {
        telemetry.status = "LIVE_NO_MATCHES";
        console.log(`[CatawikiScraper] Apify search returned 0 items for ${cleanId}.`);
        return { lots: [], telemetry };
      }

      const parsed = this.parseApifyDatasetWithTelemetry(rawItems, cleanId, params.productName, actorId);
      telemetry.acceptedResultCount = parsed.acceptedCount;
      telemetry.rejectedResultCount = parsed.rejectedCount;
      telemetry.rejectionReasonCounts = parsed.rejectionReasonCounts;
      telemetry.rejectionDetails = parsed.rejectionDetails;

      if (parsed.lots.length > 0) {
        telemetry.status = "LIVE_SUCCESS";
        console.log(`[CatawikiScraper] Successfully accepted ${parsed.lots.length} genuine lots (rejected ${parsed.rejectedCount}) for ${cleanId}.`);
      } else {
        telemetry.status = "RESULTS_REJECTED";
        console.warn(`[CatawikiScraper] All ${rawItems.length} raw results for ${cleanId} were rejected during validation.`);
      }

      return { lots: parsed.lots, telemetry };
    } catch (err) {
      telemetry.durationMs = Date.now() - startTime;
      telemetry.status = "PROVIDER_FAILED";
      telemetry.errorCode = "FETCH_EXCEPTION";
      telemetry.errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[CatawikiScraper] Apify call failed for ${cleanId}:`, err);
      return { lots: [], telemetry };
    }
  }

  /**
   * Validates and parses raw Apify dataset records into structured lots.
   * Strictly verifies set number boundary regex matching and filters malformed observations.
   */
  static parseApifyDataset(items: RawApifyLotItem[], setNumber: string): CatawikiScrapedLot[] {
    const res = this.parseApifyDatasetWithTelemetry(items, setNumber);
    return res.lots;
  }

  /**
   * Enhanced dataset parser tracking accepted vs rejected lots with granular rejection reasons.
   */
  static parseApifyDatasetWithTelemetry(
    items: RawApifyLotItem[],
    identifier: string,
    productName?: string | null,
    actorId?: string
  ): {
    lots: CatawikiScrapedLot[];
    acceptedCount: number;
    rejectedCount: number;
    rejectionReasonCounts: Record<CatawikiRejectionReason, number>;
    rejectionDetails: Array<{ title?: string; url?: string; reason: CatawikiRejectionReason; detail?: string }>;
  } {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^0-9A-Za-z])${escaped}(?:[^0-9A-Za-z]|$)`, "i");

    const lots: CatawikiScrapedLot[] = [];
    const seenListingIds = new Set<string>();

    const rejectionReasonCounts: Record<CatawikiRejectionReason, number> = {
      IDENTIFIER_MISMATCH: 0,
      INVALID_PRICE: 0,
      INVALID_URL: 0,
      CURRENCY_UNSUPPORTED: 0,
      DUPLICATE: 0,
      MISSING_REQUIRED_DATA: 0,
      CONDITION_MISMATCH: 0,
    };

    const rejectionDetails: Array<{ title?: string; url?: string; reason: CatawikiRejectionReason; detail?: string }> = [];

    for (const item of items) {
      const rawTitle = String(item.title || item.name || "").trim();
      const rawUrl = item.url || item.lot_url || item.lotUrl;

      // 1. Missing required title
      if (!rawTitle) {
        rejectionReasonCounts.MISSING_REQUIRED_DATA++;
        rejectionDetails.push({ title: "", reason: "MISSING_REQUIRED_DATA", detail: "Empty title" });
        continue;
      }

      // 2. Exact identifier boundary match check (in title OR in URL slug)
      const urlText = typeof rawUrl === "string" ? rawUrl : "";
      const matchesId = regex.test(rawTitle) || regex.test(urlText);
      if (!matchesId) {
        rejectionReasonCounts.IDENTIFIER_MISMATCH++;
        rejectionDetails.push({ title: rawTitle, url: urlText, reason: "IDENTIFIER_MISMATCH", detail: `Does not contain ${identifier}` });
        continue;
      }

      // 3. Price parsing and validation
      let rawPrice: unknown;
      if (typeof item.currentBidValue === "number") {
        rawPrice = item.currentBidValue;
      } else if (typeof item.currentBid === "object" && item.currentBid !== null && "EUR" in item.currentBid) {
        rawPrice = (item.currentBid as { EUR?: number }).EUR;
      } else if (typeof item.currentBid === "number" || typeof item.currentBid === "string") {
        rawPrice = item.currentBid;
      } else if (item.current_bid !== undefined) {
        rawPrice = item.current_bid;
      } else if (typeof item.buyNowValue === "number") {
        rawPrice = item.buyNowValue;
      } else if (typeof item.buyNow === "object" && item.buyNow !== null && "EUR" in item.buyNow) {
        rawPrice = (item.buyNow as { EUR?: number }).EUR;
      } else if (item.sold_price !== undefined) {
        rawPrice = item.sold_price;
      } else if (item.soldPrice !== undefined) {
        rawPrice = item.soldPrice;
      } else if (item.price !== undefined) {
        rawPrice = item.price;
      } else if (item.bids?.[0]?.amount !== undefined) {
        rawPrice = item.bids[0].amount;
      }

      const numPrice = parseCatawikiPrice(rawPrice);

      if (numPrice <= 0 || isNaN(numPrice) || numPrice < 0.05 || numPrice > 15000) {
        rejectionReasonCounts.INVALID_PRICE++;
        rejectionDetails.push({ title: rawTitle, url: urlText, reason: "INVALID_PRICE", detail: `Price ${numPrice} outside valid bounds` });
        continue;
      }

      // 4. Currency resolution and conversion
      const rawCurrency = String(item.currentBidCurrency || item.currency || "EUR").toUpperCase().trim();
      let normalizedEurPrice = numPrice;

      if (rawCurrency !== "EUR") {
        if (["USD", "GBP", "CHF", "CAD", "AUD"].includes(rawCurrency)) {
          normalizedEurPrice = EvidenceValidator.convertToEur(numPrice, rawCurrency);
        } else {
          rejectionReasonCounts.CURRENCY_UNSUPPORTED++;
          rejectionDetails.push({ title: rawTitle, url: urlText, reason: "CURRENCY_UNSUPPORTED", detail: `Unsupported currency: ${rawCurrency}` });
          continue;
        }
      }

      // 5. Genuine URL check — NEVER manufacture synthetic URLs. Set undefined if simulated or absent.
      let externalUrl: string | undefined = undefined;
      if (urlText && urlText.startsWith("http") && !urlText.toLowerCase().includes("simulated")) {
        const normalizedUrl = EvidenceValidator.normalizeUrl(urlText);
        if (EvidenceValidator.isRecognizedMarketplaceDomain(normalizedUrl)) {
          externalUrl = normalizedUrl;
        }
      }

      // 6. Deduplication
      const dedupeKey = externalUrl || String(item.id || item.lot_id || item.lotId || `cw-${rawTitle}`);
      if (seenListingIds.has(dedupeKey)) {
        rejectionReasonCounts.DUPLICATE++;
        rejectionDetails.push({ title: rawTitle, url: externalUrl, reason: "DUPLICATE", detail: "Duplicate listing" });
        continue;
      }
      seenListingIds.add(dedupeKey);

      // 7. Seller normalization
      let sellerName: string | undefined = undefined;
      if (item.sellerShopName && String(item.sellerShopName).trim()) {
        sellerName = String(item.sellerShopName).trim();
      } else if (item.sellerUserName && String(item.sellerUserName).trim()) {
        sellerName = String(item.sellerUserName).trim();
      } else if (typeof item.seller === "object" && item.seller !== null && (item.seller.name || item.seller.username)) {
        sellerName = String(item.seller.name || item.seller.username).trim();
      } else if (typeof item.seller === "string" && item.seller.trim().length > 0) {
        sellerName = item.seller.trim();
      }
      if (sellerName && sellerName.toLowerCase().includes("simulated")) {
        sellerName = undefined;
      }

      // 8. Sale type resolution
      const isClosed = Boolean(item.is_closed || item.isClosed || item.status === "closed" || item.closeStatus === "closed" || item.sold_price || item.soldPrice);
      const isBiddingOpen = Boolean(item.status === "bidding_open" || item.status === "open" || item.status === "live" || item.closeStatus === "open" || item.currentBidValue || item.current_bid || item.currentBid);

      let priceType: PriceType;
      if (isClosed && (item.sold_price || item.soldPrice)) {
        priceType = PriceType.SOLD_PRICE;
      } else if (isBiddingOpen || item.bids?.length) {
        priceType = PriceType.CURRENT_BID;
      } else if (item.price || item.buyNow || item.buyNowValue) {
        priceType = PriceType.ASKING_PRICE;
      } else {
        priceType = PriceType.CURRENT_BID;
      }

      // Shipping cost parsing
      const rawShipping = item.shipping_fee ?? item.shippingFee ?? item.shipping;
      const parsedShipping = rawShipping !== undefined && rawShipping !== null ? parseCatawikiPrice(rawShipping) : 15.0;

      // Condition parsing
      const conditionText = `${item.condition || ""} ${item.subtitle || ""} ${rawTitle}`.toUpperCase();
      const condition = conditionText.includes("SEALED") || conditionText.includes("MINT") || conditionText.includes("NEW") || conditionText.includes("UNUSED") ? "NEW_SEALED" : "USED_COMPLETE";

      const listingId = String(item.id || item.lot_id || item.lotId || (externalUrl ? `cw-${externalUrl}` : `cw-${Date.now()}-${lots.length}`));

      const auctionEndDate = item.biddingEndTime || item.end_date || item.endDate;
      const capturedDate = item.captured_at || item.capturedAt;

      const effectiveActor = actorId || process.env.APIFY_ACTOR_ID || "solidcode~catawiki-scraper";
      const resolvedProvider = effectiveActor.includes("~")
        ? `apify/${effectiveActor.replace("~", "/")}`
        : `apify/${effectiveActor}`;

      lots.push({
        externalListingId: listingId,
        title: rawTitle,
        price: normalizedEurPrice,
        priceType,
        currency: "EUR",
        shippingCost: parsedShipping,
        condition,
        seller: sellerName,
        externalUrl,
        auctionEndAt: auctionEndDate ? new Date(auctionEndDate) : undefined,
        capturedAt: capturedDate ? new Date(capturedDate) : new Date(),
        provenance: ObservationProvenance.LIVE_SCRAPE,
        provider: resolvedProvider,
        rawMetadataJson: JSON.stringify({
          rawPrice,
          originalPrice: numPrice,
          originalCurrency: rawCurrency,
          isClosed,
          status: item.status || item.closeStatus,
          productName,
        }),
      });
    }

    const acceptedCount = lots.length;
    const rejectedCount = items.length - acceptedCount;

    return {
      lots,
      acceptedCount,
      rejectedCount,
      rejectionReasonCounts,
      rejectionDetails,
    };
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


