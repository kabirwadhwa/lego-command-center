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
    console.log(`[CatawikiScraper] provider=CATAWIKI query="${cleanId}" queries=[${queries.join(", ")}] request started`);

    try {
      const allRawItems: RawApifyLotItem[] = [];

      // Step 1: Discover Completed / Sold Lots via Google Search Scraper
      const googleQuery = `site:catawiki.com/en/l/ "${cleanId}" LEGO`;
      console.log(`[CatawikiScraper] Step 1: Discovering completed lots via Google: ${googleQuery}`);

      let candidateLotUrls: string[] = [];
      try {
        const googleRes = await fetch(
          `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=45`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              queries: googleQuery,
              maxPagesPerQuery: 1,
              resultsPerPage: 10,
            }),
          }
        );

        if (googleRes.status === 401 || googleRes.status === 403) {
          telemetry.status = "AUTH_FAILED";
          telemetry.errorCode = `HTTP_${googleRes.status}`;
          telemetry.errorMessage = "Apify authentication failed. Invalid APIFY_API_TOKEN.";
          console.warn(`[CatawikiScraper] Apify authentication failed (HTTP ${googleRes.status}).`);
          return { lots: [], telemetry };
        }

        if (googleRes.ok) {
          const googleData = await googleRes.json();
          if (Array.isArray(googleData) && googleData[0]?.organicResults) {
            const organics = googleData[0].organicResults as Array<{ url?: string; title?: string; description?: string }>;
            const escaped = cleanId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const idRegex = new RegExp(`(?:^|[^0-9A-Za-z])${escaped}(?:[^0-9A-Za-z]|$)`, "i");

            for (const org of organics) {
              if (!org.url) continue;
              const matchesCw = /catawiki\.(?:com|nl|fr|de|be|it|es)\/(?:[a-z]{2}\/)?l\/([0-9]+)/i.test(org.url);
              const text = `${org.title || ""} ${org.url} ${org.description || ""}`;
              if (matchesCw && idRegex.test(text)) {
                candidateLotUrls.push(org.url);
              }
            }
          }
        }
      } catch (gErr) {
        console.warn(`[CatawikiScraper] Google search discovery warning for ${cleanId}:`, gErr);
      }

      candidateLotUrls = Array.from(new Set(candidateLotUrls)).slice(0, 8);
      console.log(`[CatawikiScraper] Found ${candidateLotUrls.length} candidate completed lot URLs for ${cleanId}:`, candidateLotUrls);

      // Step 2: Extract Completed Lot Details via scrapesage~catawiki-scraper
      if (candidateLotUrls.length > 0) {
        try {
          const scrapeRes = await fetch(
            `https://api.apify.com/v2/acts/scrapesage~catawiki-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=60`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lotUrls: candidateLotUrls,
              }),
            }
          );

          if (scrapeRes.ok) {
            const scrapedItems = await scrapeRes.json();
            if (Array.isArray(scrapedItems)) {
              allRawItems.push(...scrapedItems);
            }
          } else {
            console.warn(`[CatawikiScraper] scrapesage returned HTTP ${scrapeRes.status}`);
          }
        } catch (sErr) {
          console.warn(`[CatawikiScraper] scrapesage lot extraction error for ${cleanId}:`, sErr);
        }
      }

      // Step 3: If no completed lots retrieved, check solidcode~catawiki-scraper for active lots
      if (allRawItems.length === 0) {
        try {
          console.log(`[CatawikiScraper] Step 3: Checking solidcode~catawiki-scraper for active lots for ${cleanId}`);
          const solidRes = await fetch(
            `https://api.apify.com/v2/acts/solidcode~catawiki-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=45`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                searchQueries: queries,
                maxResults: params.maxItems || 10,
                language: "en",
              }),
            }
          );

          if (solidRes.ok) {
            const solidItems = await solidRes.json();
            if (Array.isArray(solidItems)) {
              allRawItems.push(...solidItems);
            }
          }
        } catch (scErr) {
          console.warn(`[CatawikiScraper] solidcode scraper error for ${cleanId}:`, scErr);
        }
      }

      telemetry.durationMs = Date.now() - startTime;
      telemetry.requestSuccessful = true;
      telemetry.rawResultCount = allRawItems.length;

      if (allRawItems.length === 0) {
        telemetry.status = "LIVE_NO_MATCHES";
        console.log(`[CatawikiScraper] Search returned 0 items for ${cleanId}.`);
        return { lots: [], telemetry };
      }

      const parsed = this.parseApifyDatasetWithTelemetry(allRawItems, cleanId, params.productName, "scrapesage~catawiki-scraper");
      telemetry.acceptedResultCount = parsed.acceptedCount;
      telemetry.rejectedResultCount = parsed.rejectedCount;
      telemetry.rejectionReasonCounts = parsed.rejectionReasonCounts;
      telemetry.rejectionDetails = parsed.rejectionDetails;

      if (parsed.lots.length > 0) {
        telemetry.status = "LIVE_SUCCESS";
        console.log(`[CatawikiScraper] Successfully accepted ${parsed.lots.length} genuine lots (rejected ${parsed.rejectedCount}) for ${cleanId}.`);
      } else {
        telemetry.status = "RESULTS_REJECTED";
        console.warn(`[CatawikiScraper] All ${allRawItems.length} raw results for ${cleanId} were rejected during validation.`);
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
      const rawTitle = String(
        item.title ||
        item.name ||
        (typeof item.specs === "object" && item.specs !== null && (item.specs as Record<string, string>)["Set name"]) ||
        (typeof item.specs === "object" && item.specs !== null && (item.specs as Record<string, string>)["Set Name"]) ||
        ""
      ).trim();
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
      if (typeof item.currentBidEUR === "number") {
        rawPrice = item.currentBidEUR;
      } else if (typeof item.currentBidValue === "number") {
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
      const isSold = Boolean(item.sold || item.sold_price || item.soldPrice);
      const isClosed = Boolean(item.closed || item.is_closed || item.isClosed || item.status === "closed" || item.closeStatus === "closed" || item.closeStatus === "Closed" || item.sold_price || item.soldPrice);
      const isBiddingOpen = Boolean(item.open || item.status === "bidding_open" || item.status === "open" || item.status === "live" || item.status === "open_now" || item.closeStatus === "open" || item.closeStatus === "Open");

      let priceType: PriceType;
      if (isClosed && isSold) {
        priceType = PriceType.SOLD_PRICE;
      } else if (isBiddingOpen || item.bids?.length) {
        priceType = PriceType.CURRENT_BID;
      } else if (item.price || item.buyNow || item.buyNowValue) {
        priceType = PriceType.ASKING_PRICE;
      } else {
        priceType = PriceType.CURRENT_BID;
      }

      // Shipping cost parsing — strictly no default 15.0
      let parsedShipping: number | undefined = undefined;
      if (Array.isArray(item.shippingRates) && item.shippingRates.length > 0) {
        const preferredRate = item.shippingRates.find(
          (r: { regionCode?: string; price?: number }) =>
            r && typeof r.price === "number" && r.price > 0 &&
            ["be", "de", "fr", "nl", "europe"].includes(String(r.regionCode).toLowerCase())
        ) || item.shippingRates.find((r: { price?: number }) => r && typeof r.price === "number" && r.price > 0);
        if (preferredRate && typeof preferredRate.price === "number") {
          parsedShipping = preferredRate.price;
        }
      } else {
        const rawShipping = item.shipping_fee ?? item.shippingFee ?? item.shipping;
        if (rawShipping !== undefined && rawShipping !== null) {
          const parsed = parseCatawikiPrice(rawShipping);
          if (parsed > 0) parsedShipping = parsed;
        }
      }

      // Condition parsing — strictly no default USED_COMPLETE
      const specs = (typeof item.specs === "object" && item.specs !== null) ? (item.specs as Record<string, string>) : {};
      const conditionText = `${specs.Condition || item.condition || ""} ${specs["Complete set"] ? "Complete: " + specs["Complete set"] : ""} ${item.subtitle || ""} ${rawTitle}`.toUpperCase();

      let condition = "UNKNOWN";
      if (
        specs.Condition?.toUpperCase() === "NEW" ||
        conditionText.includes("SEALED") ||
        conditionText.includes("MINT") ||
        conditionText.includes("NEW") ||
        conditionText.includes("UNUSED") ||
        conditionText.includes("MISB") ||
        conditionText.includes("BNIB")
      ) {
        condition = "NEW_SEALED";
      } else if (specs["Complete set"] === "No" || conditionText.includes("INCOMPLETE")) {
        condition = "USED_INCOMPLETE";
      } else if (specs["Complete set"] === "Yes" || conditionText.includes("COMPLETE")) {
        condition = "USED_COMPLETE";
      } else if (specs.Condition?.toUpperCase() === "USED" || conditionText.includes("USED") || conditionText.includes("PRE-OWNED")) {
        condition = "USED_UNKNOWN";
      }

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


