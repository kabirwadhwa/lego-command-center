import { ObservationProvenance } from "@prisma/client";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult } from "./types";
import { EvidenceValidator } from "./evidenceValidator";

export class BrickLinkProvider implements IMarketResearchProvider {
  id = "bricklink";
  name = "BrickLink Marketplace";

  isConfigured(): boolean {
    return !!(
      process.env.BRICKLINK_CONSUMER_KEY &&
      process.env.BRICKLINK_CONSUMER_SECRET &&
      process.env.BRICKLINK_TOKEN_VALUE &&
      process.env.BRICKLINK_TOKEN_SECRET
    );
  }

  getMissingCredentials(): string[] {
    const missing: string[] = [];
    if (!process.env.BRICKLINK_CONSUMER_KEY) missing.push("BRICKLINK_CONSUMER_KEY");
    if (!process.env.BRICKLINK_CONSUMER_SECRET) missing.push("BRICKLINK_CONSUMER_SECRET");
    if (!process.env.BRICKLINK_TOKEN_VALUE) missing.push("BRICKLINK_TOKEN_VALUE");
    if (!process.env.BRICKLINK_TOKEN_SECRET) missing.push("BRICKLINK_TOKEN_SECRET");
    return missing;
  }

  async searchMarket(
    product: ResolvedLegoProduct
  ): Promise<ProviderResult> {
    if (!this.isConfigured()) {
      const missing = this.getMissingCredentials();
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NOT_CONFIGURED",
        evidence: [],
        error: `BrickLink unconfigured: missing credentials (${missing.join(", ")}).`,
      };
    }

    const itemType = product.identifierType === "LEGO_PART" ? "PART" : "SET";
    const itemNo = itemType === "SET" && !product.canonicalIdentifier.includes("-")
      ? `${product.canonicalIdentifier}-1`
      : product.canonicalIdentifier;

    const queriesAttempted = [`BrickLink Price Guide for ${itemType} ${itemNo}`];

    try {
      // In production with OAuth 1.0 credentials:
      // Fetch Price Guide for both new and used items
      const url = `https://api.bricklink.com/api/store/v1/items/${itemType}/${itemNo}/price?guide_type=sold`;

      const res = await fetch(url, {
        headers: {
          // OAuth authorization header would be assembled here using credentials
          Authorization: `OAuth realm="",oauth_consumer_key="${process.env.BRICKLINK_CONSUMER_KEY}"`,
        },
      });

      if (!res.ok) {
        throw new Error(`BrickLink API returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const priceDetails = data?.data?.price_detail || [];

      if (!Array.isArray(priceDetails) || priceDetails.length === 0) {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "NO_MATCHES",
          evidence: [],
          queriesAttempted,
        };
      }

      const validatedEvidence: MarketEvidence[] = [];

      for (const entry of priceDetails) {
        const unitPrice = parseFloat(entry.unit_price);
        const externalUrl = itemType === "PART"
          ? `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${product.canonicalIdentifier}`
          : `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${itemNo}`;

        const candidate = EvidenceValidator.validateCandidate({
          provider: this.id,
          marketplace: "BRICKLINK",
          title: `BrickLink Sold: ${product.name || product.canonicalIdentifier}`,
          price: unitPrice,
          currency: data?.data?.currency_code || "EUR",
          saleType: "SOLD",
          seller: null,
          externalUrl,
          observedAt: entry.date_ordered ? new Date(entry.date_ordered) : new Date(),
          canonicalIdentifier: product.canonicalIdentifier,
          productName: product.name,
          provenance: ObservationProvenance.LIVE_API,
        });

        if (candidate) {
          validatedEvidence.push(candidate);
        }
      }

      return {
        providerId: this.id,
        providerName: this.name,
        status: validatedEvidence.length > 0 ? "SUCCESS" : "NO_MATCHES",
        evidence: validatedEvidence,
        queriesAttempted,
      };
    } catch (err) {
      console.error(`[BrickLinkProvider] Query failed for ${itemNo}:`, err);
      return {
        providerId: this.id,
        providerName: this.name,
        status: "FAILED",
        evidence: [],
        error: err instanceof Error ? err.message : "BrickLink API request failed",
        queriesAttempted,
      };
    }
  }
}
