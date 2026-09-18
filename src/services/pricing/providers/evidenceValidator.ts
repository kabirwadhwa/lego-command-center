import { ObservationProvenance } from "@prisma/client";
import { MarketEvidence, SaleType } from "./types";
import { isEligibleForRealMarketPricing, isGenuineListingUrl } from "../evidenceEligibility";

// Supported marketplace host domains for genuine listing verification
const RECOGNIZED_DOMAINS = [
  "ebay.com", "ebay.de", "ebay.co.uk", "ebay.fr", "ebay.nl", "ebay.be", "ebay.it", "ebay.es",
  "bricklink.com",
  "brickowl.com",
  "catawiki.com", "catawiki.nl", "catawiki.fr",
  "toypro.com",
  "brickset.com",
  "vinted.be", "vinted.fr", "vinted.nl", "vinted.de",
  "bol.com",
  "2dehands.be", "marktplaats.nl", "kleinanzeigen.de",
  "lego.com",
  "amazon.com", "amazon.de", "amazon.fr", "amazon.co.uk",
];

// Common LEGO part colors
const COMMON_COLORS = [
  "White",
  "Black",
  "Light Bluish Gray",
  "Dark Bluish Gray",
  "Light Gray",
  "Dark Gray",
  "Red",
  "Blue",
  "Yellow",
  "Green",
  "Orange",
  "Dark Red",
  "Dark Blue",
  "Tan",
  "Dark Tan",
  "Reddish Brown",
  "Trans-Clear",
];

// Conservative FX rates to EUR
const FX_RATES_TO_EUR: Record<string, number> = {
  EUR: 1.0,
  USD: 1 / 1.08, // 1 USD = 0.926 EUR
  GBP: 1 / 0.85, // 1 GBP = 1.176 EUR
  CHF: 1 / 0.96, // 1 CHF = 1.042 EUR
  CAD: 1 / 1.48, // 1 CAD = 0.676 EUR
  AUD: 1 / 1.65, // 1 AUD = 0.606 EUR
};

export class EvidenceValidator {
  /**
   * Normalizes a URL by stripping tracking parameters (utm_*, gclid, ref, etc.)
   */
  static normalizeUrl(url: string): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      // Only strip empty or generic hashes, keep parameter hashes (like BrickLink #T=S&C=1)
      if (parsed.hash && !parsed.hash.includes("=")) {
        parsed.hash = "";
      }
      const paramsToKeep = new URLSearchParams();
      // Keep search or item id params, discard tracking params
      for (const [key, value] of parsed.searchParams.entries()) {
        const lowerKey = key.toLowerCase();
        if (
          !lowerKey.startsWith("utm_") &&
          lowerKey !== "gclid" &&
          lowerKey !== "fbclid" &&
          lowerKey !== "ref" &&
          lowerKey !== "src"
        ) {
          paramsToKeep.set(key, value);
        }
      }
      parsed.search = paramsToKeep.toString() ? `?${paramsToKeep.toString()}` : "";
      return parsed.toString();
    } catch {
      return url.split("?")[0].trim();
    }
  }

  /**
   * Checks whether a URL belongs to a recognized marketplace or retailer domain.
   */
  static isRecognizedMarketplaceDomain(url: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return RECOGNIZED_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
    } catch {
      return false;
    }
  }

  /**
   * Calculates a match score between candidate listing text and target LEGO product.
   * Returns a score between 0.0 and 1.0.
   */
  static calculateProductMatchScore(
    text: string,
    canonicalIdentifier: string,
    productName?: string | null
  ): number {
    if (!text || !canonicalIdentifier) return 0;

    const lowerText = text.toLowerCase();
    const id = canonicalIdentifier.toLowerCase();

    // Check exact canonical identifier with word boundaries
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRegex = new RegExp(`(?:^|[^0-9a-z])${escapedId}(?:[^0-9a-z]|$)`, "i");
    const hasExactId = idRegex.test(text);

    if (!hasExactId) {
      return 0.0;
    }

    let score = 0.7; // Base score for exact identifier match

    // Check for "lego" keyword
    if (lowerText.includes("lego")) {
      score += 0.15;
    }

    // Check for name tokens if available
    if (productName) {
      const tokens = productName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(t => t.length > 3 && t !== "lego" && t !== "set" && t !== "part");

      if (tokens.length > 0) {
        const matches = tokens.filter(t => lowerText.includes(t));
        const tokenMatchRatio = matches.length / tokens.length;
        score += tokenMatchRatio * 0.15;
      }
    }

    return Math.min(1.0, Math.round(score * 100) / 100);
  }

  /**
   * Extracts price and currency from a string if not explicitly supplied.
   */
  static extractPriceAndCurrency(rawText: string): { price: number; currency: string } | null {
    if (!rawText) return null;

    // Pattern 1: EUR symbol or text (e.g. € 149.99, 149,99 EUR)
    const eurMatch = rawText.match(/(?:€|EUR)\s?([0-9]+(?:[.,][0-9]{2})?)/i) ||
                     rawText.match(/([0-9]+(?:[.,][0-9]{2})?)\s?(?:€|EUR)/i);
    if (eurMatch) {
      const val = parseFloat(eurMatch[1].replace(",", "."));
      if (!isNaN(val) && val > 0 && isFinite(val)) {
        return { price: val, currency: "EUR" };
      }
    }

    // Pattern 2: USD symbol or text (e.g. $ 149.99, 149.99 USD)
    const usdMatch = rawText.match(/(?:\$|USD)\s?([0-9]+(?:[.,][0-9]{2})?)/i) ||
                     rawText.match(/([0-9]+(?:[.,][0-9]{2})?)\s?(?:USD)/i);
    if (usdMatch) {
      const val = parseFloat(usdMatch[1].replace(",", "."));
      if (!isNaN(val) && val > 0 && isFinite(val)) {
        return { price: val, currency: "USD" };
      }
    }

    // Pattern 3: GBP symbol or text (e.g. £ 149.99, 149.99 GBP)
    const gbpMatch = rawText.match(/(?:£|GBP)\s?([0-9]+(?:[.,][0-9]{2})?)/i) ||
                     rawText.match(/([0-9]+(?:[.,][0-9]{2})?)\s?(?:GBP)/i);
    if (gbpMatch) {
      const val = parseFloat(gbpMatch[1].replace(",", "."));
      if (!isNaN(val) && val > 0 && isFinite(val)) {
        return { price: val, currency: "GBP" };
      }
    }

    return null;
  }

  /**
   * Converts a given currency amount to EUR.
   */
  static convertToEur(price: number, currency: string): number {
    const code = currency.toUpperCase().trim();
    const rate = FX_RATES_TO_EUR[code] || 1.0;
    return Math.round((price * rate) * 100) / 100;
  }

  /**
   * Classifies sale type based on listing text.
   */
  static classifySaleType(text: string): SaleType {
    const lower = text.toLowerCase();
    if (
      lower.includes("sold") ||
      lower.includes("ended") ||
      lower.includes("completed listing") ||
      lower.includes("winning bid")
    ) {
      return "SOLD";
    }
    if (
      lower.includes("bids") ||
      lower.includes("current bid") ||
      lower.includes("auction")
    ) {
      return "AUCTION";
    }
    return "ACTIVE_LISTING";
  }

  /**
   * Classifies condition based on listing text.
   */
  static classifyCondition(text: string): string | null {
    const lower = text.toLowerCase();
    if (
      lower.includes("new") ||
      lower.includes("sealed") ||
      lower.includes("misb") ||
      lower.includes("bnib") ||
      lower.includes("brand new")
    ) {
      return "NEW_SEALED";
    }
    if (
      lower.includes("used") ||
      lower.includes("pre-owned") ||
      lower.includes("complete") ||
      lower.includes("assembled")
    ) {
      return "USED_COMPLETE";
    }
    if (lower.includes("damaged box") || lower.includes("box damage")) {
      return "DAMAGED_BOX";
    }
    return null;
  }

  /**
   * Detects color variations in text for LEGO parts.
   */
  static detectPartColor(text: string): string | null {
    const lower = text.toLowerCase();
    for (const color of COMMON_COLORS) {
      if (lower.includes(color.toLowerCase())) {
        return color;
      }
    }
    return null;
  }

  /**
   * Validates a raw candidate evidence record.
   * Returns a clean MarketEvidence object or null if rejected.
   */
  static validateCandidate(params: {
    provider: string;
    marketplace: string;
    title: string;
    price?: number | null;
    currency?: string | null;
    rawTextForExtraction?: string;
    shipping?: number | null;
    condition?: string | null;
    saleType?: SaleType | null;
    seller?: string | null;
    externalUrl: string;
    observedAt?: Date | null;
    canonicalIdentifier: string;
    productName?: string | null;
    provenance?: ObservationProvenance;
    rawMetadata?: Record<string, unknown>;
  }): MarketEvidence | null {
    const {
      provider,
      marketplace,
      title,
      externalUrl,
      canonicalIdentifier,
      productName,
      provenance = ObservationProvenance.LIVE_SEARCH,
    } = params;

    // 1. URL Integrity check
    if (!isGenuineListingUrl(externalUrl)) {
      return null;
    }

    // 2. Marketplace domain check
    if (!this.isRecognizedMarketplaceDomain(externalUrl)) {
      return null;
    }

    // 3. Product match score check
    const fullSearchContext = `${title} ${params.rawTextForExtraction || ""}`;
    const matchScore = this.calculateProductMatchScore(fullSearchContext, canonicalIdentifier, productName);
    if (matchScore < 0.6) {
      return null;
    }

    // 4. Price & currency resolution
    let rawPrice = params.price;
    let rawCurrency = params.currency || "EUR";

    if (rawPrice === undefined || rawPrice === null || rawPrice <= 0) {
      const extracted = this.extractPriceAndCurrency(fullSearchContext);
      if (!extracted) {
        return null;
      }
      rawPrice = extracted.price;
      rawCurrency = extracted.currency;
    }

    if (isNaN(rawPrice) || rawPrice <= 0 || !isFinite(rawPrice)) {
      return null;
    }

    // Sanity range check (e.g. LEGO prices between €0.05 and €15,000)
    if (rawPrice < 0.05 || rawPrice > 15000) {
      return null;
    }

    const normalizedEurPrice = this.convertToEur(rawPrice, rawCurrency);

    // 5. Determine sale type and condition
    const saleType = params.saleType || this.classifySaleType(fullSearchContext);
    const condition = params.condition || this.classifyCondition(fullSearchContext);
    const color = this.detectPartColor(fullSearchContext);

    // 6. Anti-simulation invariant check
    const candidate: MarketEvidence = {
      provider,
      marketplace: marketplace.toUpperCase().trim(),
      title: title.trim(),
      price: normalizedEurPrice,
      originalPrice: rawPrice,
      originalCurrency: rawCurrency,
      currency: "EUR",
      shipping: params.shipping !== undefined ? params.shipping : null,
      condition,
      saleType,
      seller: params.seller?.trim() || null,
      externalUrl: this.normalizeUrl(externalUrl),
      observedAt: params.observedAt || new Date(),
      productMatchScore: matchScore,
      provenance,
      color,
      rawMetadata: params.rawMetadata,
    };

    if (!isEligibleForRealMarketPricing(candidate)) {
      return null;
    }

    return candidate;
  }

  /**
   * Deduplicates evidence items across providers.
   * Uses normalized URL and listing identity.
   */
  static deduplicate(evidenceList: MarketEvidence[]): MarketEvidence[] {
    const seenSignatures = new Set<string>();
    const unique: MarketEvidence[] = [];

    for (const item of evidenceList) {
      const normUrl = this.normalizeUrl(item.externalUrl).toLowerCase();

      // Signature: URL + price + seller
      const sig = `${normUrl}_${item.price.toFixed(2)}_${(item.seller || "").toLowerCase()}`;

      if (seenSignatures.has(sig)) {
        continue;
      }

      seenSignatures.add(sig);
      unique.push(item);
    }

    return unique;
  }
}
