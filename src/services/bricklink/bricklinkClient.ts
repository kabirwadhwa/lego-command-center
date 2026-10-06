import {
  BrickLinkCredentials,
  signBrickLinkRequest,
} from "./bricklinkOAuth";

export type BrickLinkItemType = "SET" | "PART" | "MINIFIG" | "GEAR" | "BOOK" | "CATALOG" | "INSTRUCTION";

export type BrickLinkGuideType = "sold" | "stock";
export type BrickLinkCondition = "N" | "U";

export interface BrickLinkCatalogItem {
  no: string;
  name: string;
  type: BrickLinkItemType;
  categoryId?: number;
  imageThumbnailUrl?: string;
  yearReleased?: number;
  weight?: string;
  dimension?: string;
}

export interface BrickLinkPriceDetailEntry {
  quantity: number;
  unitPrice: number;
  sellerCountryCode?: string | null;
  buyerCountryCode?: string | null;
  dateOrdered?: Date | null;
  shippingAvailable?: boolean | null;
  quCode?: string | null;
}

export interface BrickLinkPriceGuideSummary {
  itemNo: string;
  itemType: BrickLinkItemType;
  guideType: BrickLinkGuideType;
  condition: BrickLinkCondition;
  currencyCode: string;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  qtyAvgPrice: number | null;
  unitQuantity: number;
  totalQuantity: number;
  vatIncluded: false;
  priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE";
}

export interface BrickLinkPriceGuideResult {
  summary: BrickLinkPriceGuideSummary;
  priceDetails: BrickLinkPriceDetailEntry[];
  rawMeta?: Record<string, unknown>;
}

export type BrickLinkDiagnosticStatus =
  | "SUCCESS"
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "API_FAILED"
  | "PARSE_FAILED"
  | "NO_DATA";

export interface BrickLinkDiagnosticResult {
  status: BrickLinkDiagnosticStatus;
  message: string;
  httpStatus?: number;
  itemChecked?: string;
  summary?: BrickLinkPriceGuideSummary;
  detailCount?: number;
  durationMs: number;
}

export interface BrickLinkClientOptions {
  credentials?: BrickLinkCredentials;
  baseUrl?: string;
  defaultCurrency?: string;
  defaultRegion?: string;
  defaultCountry?: string;
}

/**
 * Strict numeric parser for price fields.
 * Returns null for invalid, NaN, negative, or unparseable values. Never defaults NaN to 0.
 */
export function parseStrictPrice(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = typeof val === "number" ? val : parseFloat(String(val).trim());
  if (isNaN(num) || !isFinite(num) || num < 0) {
    return null;
  }
  return Math.round(num * 10000) / 10000;
}

/**
 * Strict integer parser for quantity fields.
 */
export function parseStrictInteger(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  const num = typeof val === "number" ? val : parseInt(String(val).trim(), 10);
  if (isNaN(num) || !isFinite(num) || num < 0) {
    return 0;
  }
  return Math.floor(num);
}

/**
 * Maps internal LEGO product identifiers to canonical BrickLink item numbers.
 * For LEGO_SET: canonical internal '10316' -> '10316-1' (unless already suffixed).
 * For LEGO_PART: canonical internal '35106' -> '35106' (never appends '-1').
 */
export function mapToBrickLinkItem(
  identifier: string,
  identifierType: string
): { itemNo: string; itemType: BrickLinkItemType } {
  const clean = identifier.trim();
  const isPart = identifierType === "LEGO_PART";
  const isMinifig = identifierType === "LEGO_MINIFIG" || /^[a-z]{2,5}\d{3,5}[a-z]?$/i.test(clean);
  const itemType: BrickLinkItemType = isMinifig ? "MINIFIG" : isPart ? "PART" : "SET";

  if (itemType === "SET") {
    // If already has -<variant>, keep it, otherwise append -1
    const itemNo = /-[0-9]+$/.test(clean) ? clean : `${clean}-1`;
    return { itemNo, itemType };
  }

  // LEGO_PART or MINIFIG: design / minifig ID without -1 suffix
  const itemNo = clean.replace(/-[0-9]+$/, "");
  return { itemNo, itemType };
}

export class BrickLinkClient {
  private credentials: BrickLinkCredentials | null = null;
  private baseUrl: string;
  private defaultCurrency: string;
  private defaultRegion?: string;
  private defaultCountry?: string;

  constructor(options?: BrickLinkClientOptions) {
    this.baseUrl = options?.baseUrl || "https://api.bricklink.com/api/store/v1";
    this.defaultCurrency = options?.defaultCurrency || process.env.BRICKLINK_PRICE_CURRENCY || "EUR";
    this.defaultRegion = options?.defaultRegion || process.env.BRICKLINK_PRICE_REGION || undefined;
    this.defaultCountry = options?.defaultCountry || process.env.BRICKLINK_PRICE_COUNTRY || undefined;

    if (options?.credentials) {
      this.credentials = options.credentials;
    } else {
      const ck = process.env.BRICKLINK_CONSUMER_KEY;
      const cs = process.env.BRICKLINK_CONSUMER_SECRET;
      const tv = process.env.BRICKLINK_TOKEN_VALUE;
      const ts = process.env.BRICKLINK_TOKEN_SECRET;

      if (ck && cs && tv && ts) {
        this.credentials = {
          consumerKey: ck.trim(),
          consumerSecret: cs.trim(),
          tokenValue: tv.trim(),
          tokenSecret: ts.trim(),
        };
      }
    }
  }

  /**
   * Verifies if all 4 OAuth 1.0 secrets are present.
   */
  isConfigured(): boolean {
    return !!(
      this.credentials?.consumerKey &&
      this.credentials?.consumerSecret &&
      this.credentials?.tokenValue &&
      this.credentials?.tokenSecret
    );
  }

  /**
   * Safe check for missing credentials without exposing secret values.
   */
  getMissingCredentials(): string[] {
    const missing: string[] = [];
    if (!process.env.BRICKLINK_CONSUMER_KEY) missing.push("BRICKLINK_CONSUMER_KEY");
    if (!process.env.BRICKLINK_CONSUMER_SECRET) missing.push("BRICKLINK_CONSUMER_SECRET");
    if (!process.env.BRICKLINK_TOKEN_VALUE) missing.push("BRICKLINK_TOKEN_VALUE");
    if (!process.env.BRICKLINK_TOKEN_SECRET) missing.push("BRICKLINK_TOKEN_SECRET");
    return missing;
  }

  /**
   * Performs an authenticated HTTP request using OAuth 1.0 HMAC-SHA1.
   */
  private async fetchAuthenticated(
    endpoint: string,
    queryParams?: Record<string, string | number | boolean | undefined | null>
  ): Promise<{ status: number; data: unknown }> {
    if (!this.credentials || !this.isConfigured()) {
      throw new Error(`BrickLink unconfigured: missing credentials (${this.getMissingCredentials().join(", ")}).`);
    }

    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    const signed = signBrickLinkRequest(this.credentials, {
      method: "GET",
      url,
      queryParams,
    });

    // Build URL with query params
    const urlObj = new URL(url);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null) {
          urlObj.searchParams.set(k, String(v));
        }
      }
    }

    const response = await fetch(urlObj.toString(), {
      method: "GET",
      headers: {
        Authorization: signed.authorizationHeader,
        Accept: "application/json",
      },
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // response was not JSON
    }

    return {
      status: response.status,
      data: body,
    };
  }

  /**
   * Retrieves catalog item details: GET /items/{type}/{no}
   */
  async getCatalogItem(
    itemType: BrickLinkItemType,
    itemNo: string
  ): Promise<BrickLinkCatalogItem | null> {
    const res = await this.fetchAuthenticated(`/items/${itemType}/${itemNo}`);

    if (res.status === 404) {
      return null;
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`BrickLink authentication failed (HTTP ${res.status}). Verify OAuth 1.0 credentials.`);
    }

    if (res.status === 429) {
      throw new Error("BrickLink API rate limit exceeded (HTTP 429).");
    }

    if (res.status >= 500) {
      throw new Error(`BrickLink API server error (HTTP ${res.status}).`);
    }

    const json = res.data as Record<string, unknown> | null;
    const meta = json?.meta as Record<string, unknown> | undefined;
    if (meta && meta.code && Number(meta.code) !== 200) {
      if (Number(meta.code) === 404) return null;
      throw new Error(`BrickLink API error ${meta.code}: ${meta.message || "Unknown error"}`);
    }

    const data = json?.data as Record<string, unknown> | undefined;
    if (!data || typeof data.no !== "string") {
      return null;
    }

    return {
      no: String(data.no),
      name: String(data.name || ""),
      type: (data.type as BrickLinkItemType) || itemType,
      categoryId: typeof data.category_id === "number" ? data.category_id : undefined,
      imageThumbnailUrl: typeof data.thumbnail_url === "string" ? data.thumbnail_url : undefined,
      yearReleased: typeof data.year_released === "number" ? data.year_released : undefined,
      weight: typeof data.weight === "string" ? data.weight : undefined,
      dimension: typeof data.dimension === "string" ? data.dimension : undefined,
    };
  }

  /**
   * Retrieves price guide for an item: GET /items/{type}/{no}/price
   */
  async getPriceGuide(params: {
    itemType: BrickLinkItemType;
    itemNo: string;
    guideType: BrickLinkGuideType;
    condition: BrickLinkCondition;
    currencyCode?: string;
    region?: string;
    countryCode?: string;
  }): Promise<BrickLinkPriceGuideResult | null> {
    const currency = params.currencyCode || this.defaultCurrency;
    const region = params.region || this.defaultRegion;
    const country = params.countryCode || this.defaultCountry;

    const queryParams: Record<string, string | number | boolean | undefined> = {
      guide_type: params.guideType,
      new_or_used: params.condition,
      currency_code: currency,
    };

    if (country) {
      queryParams.country_code = country;
    } else if (region) {
      queryParams.region = region;
    }

    const res = await this.fetchAuthenticated(`/items/${params.itemType}/${params.itemNo}/price`, queryParams);

    if (res.status === 404) {
      return null;
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`BrickLink authentication failed (HTTP ${res.status}). Verify OAuth 1.0 credentials.`);
    }

    if (res.status === 429) {
      throw new Error("BrickLink API rate limit exceeded (HTTP 429).");
    }

    if (res.status >= 500) {
      throw new Error(`BrickLink API server error (HTTP ${res.status}).`);
    }

    const json = res.data as Record<string, unknown> | null;
    const meta = json?.meta as Record<string, unknown> | undefined;
    if (meta && meta.code && Number(meta.code) !== 200) {
      if (Number(meta.code) === 404) return null;
      throw new Error(`BrickLink API error ${meta.code}: ${meta.message || "Unknown error"}`);
    }

    const data = json?.data as Record<string, unknown> | undefined;
    if (!data) {
      return null;
    }

    // Strict summary parsing
    const summary: BrickLinkPriceGuideSummary = {
      itemNo: params.itemNo,
      itemType: params.itemType,
      guideType: params.guideType,
      condition: params.condition,
      currencyCode: typeof data.currency_code === "string" ? data.currency_code : currency,
      minPrice: parseStrictPrice(data.min_price),
      maxPrice: parseStrictPrice(data.max_price),
      avgPrice: parseStrictPrice(data.avg_price),
      qtyAvgPrice: parseStrictPrice(data.qty_avg_price),
      unitQuantity: parseStrictInteger(data.unit_quantity),
      totalQuantity: parseStrictInteger(data.total_quantity),
      vatIncluded: false,
      priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
    };

    // Strict detail parsing
    const priceDetails: BrickLinkPriceDetailEntry[] = [];
    if (Array.isArray(data.price_detail)) {
      for (const entry of data.price_detail) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const unitPrice = parseStrictPrice(e.unit_price);
        const qty = parseStrictInteger(e.quantity);

        // Require valid positive unit price and positive quantity
        if (unitPrice === null || unitPrice <= 0 || qty <= 0) {
          continue;
        }

        let dateOrdered: Date | null = null;
        if (typeof e.date_ordered === "string" && e.date_ordered.trim()) {
          const parsedDate = new Date(e.date_ordered);
          if (!isNaN(parsedDate.getTime())) {
            dateOrdered = parsedDate;
          }
        }

        priceDetails.push({
          quantity: qty,
          unitPrice,
          sellerCountryCode: typeof e.seller_country_code === "string" ? e.seller_country_code.toUpperCase() : null,
          buyerCountryCode: typeof e.buyer_country_code === "string" ? e.buyer_country_code.toUpperCase() : null,
          dateOrdered,
          shippingAvailable: typeof e.shipping_available === "boolean" ? e.shipping_available : null,
          quCode: typeof e.qu_code === "string" ? e.qu_code : null,
        });
      }
    }

    return {
      summary,
      priceDetails,
      rawMeta: meta,
    };
  }

  /**
   * Safe connection diagnostic method.
   * Probes known catalog item or price guide without exposing credentials.
   */
  async testConnection(testItemNo = "10316-1"): Promise<BrickLinkDiagnosticResult> {
    const startTime = Date.now();

    if (!this.isConfigured()) {
      return {
        status: "NOT_CONFIGURED",
        message: `BrickLink API unconfigured: missing credentials (${this.getMissingCredentials().join(", ")}).`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const guide = await this.getPriceGuide({
        itemType: "SET",
        itemNo: testItemNo,
        guideType: "sold",
        condition: "N",
      });

      const durationMs = Date.now() - startTime;

      if (!guide) {
        return {
          status: "NO_DATA",
          message: `BrickLink API responded successfully but item ${testItemNo} returned no data.`,
          httpStatus: 200,
          itemChecked: testItemNo,
          durationMs,
        };
      }

      return {
        status: "SUCCESS",
        message: `BrickLink API connected successfully. Retrieved ${guide.priceDetails.length} sold entries for ${testItemNo}.`,
        httpStatus: 200,
        itemChecked: testItemNo,
        summary: guide.summary,
        detailCount: guide.priceDetails.length,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("401") || msg.includes("403") || msg.includes("authentication failed")) {
        return {
          status: "AUTH_FAILED",
          message: "BrickLink OAuth 1.0 authentication failed. Check consumer key/secret and token value/secret.",
          httpStatus: 401,
          durationMs,
        };
      }

      if (msg.includes("429") || msg.includes("rate limit")) {
        return {
          status: "RATE_LIMITED",
          message: "BrickLink API rate limit exceeded.",
          httpStatus: 429,
          durationMs,
        };
      }

      return {
        status: "API_FAILED",
        message: `BrickLink API request failed: ${msg}`,
        durationMs,
      };
    }
  }
}
