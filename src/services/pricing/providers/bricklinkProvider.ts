import crypto from "node:crypto";
import { ObservationProvenance } from "@prisma/client";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult } from "./types";
import { EvidenceValidator } from "./evidenceValidator";
import {
  BrickLinkClient,
  BrickLinkItemType,
  BrickLinkGuideType,
  BrickLinkCondition,
  BrickLinkPriceGuideResult,
  mapToBrickLinkItem,
} from "@/services/bricklink/bricklinkClient";

export interface BrickLinkAggregateReport {
  itemNo: string;
  itemType: BrickLinkItemType;
  currency: string;
  soldNew?: {
    min: number | null;
    avg: number | null;
    qtyAvg: number | null;
    max: number | null;
    unitQty: number;
    totalQty: number;
    detailCount: number;
  };
  soldUsed?: {
    min: number | null;
    avg: number | null;
    qtyAvg: number | null;
    max: number | null;
    unitQty: number;
    totalQty: number;
    detailCount: number;
  };
  stockNew?: {
    min: number | null;
    avg: number | null;
    qtyAvg: number | null;
    max: number | null;
    unitQty: number;
    totalQty: number;
    detailCount: number;
  };
  stockUsed?: {
    min: number | null;
    avg: number | null;
    qtyAvg: number | null;
    max: number | null;
    unitQty: number;
    totalQty: number;
    detailCount: number;
  };
}

/**
 * Computes a deterministic SHA-256 fingerprint for a historical BrickLink order/listing.
 * Prevents duplicating observations upon repeated periodic API refreshes.
 */
export function generateBrickLinkObservationFingerprint(params: {
  itemType: string;
  itemNo: string;
  guideType: string;
  condition: string;
  unitPrice: number;
  quantity: number;
  dateOrdered?: Date | string | null;
  sellerCountryCode?: string | null;
  buyerCountryCode?: string | null;
}): string {
  const dateStr = params.dateOrdered instanceof Date
    ? params.dateOrdered.toISOString().split("T")[0]
    : String(params.dateOrdered || "");

  const payload = [
    "BRICKLINK",
    params.itemType,
    params.itemNo,
    params.guideType,
    params.condition,
    params.unitPrice.toFixed(4),
    params.quantity,
    dateStr,
    params.sellerCountryCode || "",
    params.buyerCountryCode || "",
  ].join("|");

  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export class BrickLinkProvider implements IMarketResearchProvider {
  id = "bricklink";
  name = "BrickLink Marketplace";
  private client: BrickLinkClient;

  constructor(customClient?: BrickLinkClient) {
    this.client = customClient || new BrickLinkClient();
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  getMissingCredentials(): string[] {
    return this.client.getMissingCredentials();
  }

  async searchMarket(
    product: ResolvedLegoProduct
  ): Promise<ProviderResult> {
    const startTime = Date.now();

    // 1. Truthful configuration check
    if (!this.isConfigured()) {
      const missing = this.getMissingCredentials();
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NOT_CONFIGURED",
        evidence: [],
        error: `BrickLink API unconfigured: missing required credentials (${missing.join(", ")}).`,
        telemetry: {
          configured: false,
          missingCredentials: missing,
          provider: this.id,
        },
      };
    }

    // 2. Reject unsupported/unknown identifiers
    if (product.identifierType === "UNKNOWN" || !product.canonicalIdentifier) {
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NO_MATCHES",
        evidence: [],
        diagnosticStatus: "UNSUPPORTED_IDENTIFIER",
        error: "Product identification could not classify identifier for BrickLink catalog lookup.",
      };
    }

    // 3. Map identifier to canonical BrickLink item number
    const { itemNo, itemType } = mapToBrickLinkItem(
      product.canonicalIdentifier,
      product.identifierType
    );

    const catalogTypeKey = itemType === "PART" ? "P" : "S";
    const catalogBaseUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${catalogTypeKey}=${itemNo}`;
    const queriesAttempted = [
      `BrickLink Catalog: ${itemType} ${itemNo}`,
      `BrickLink Price Guide: /items/${itemType}/${itemNo}/price`,
    ];

    try {
      // 4. Verify catalog item existence
      const catalogItem = await this.client.getCatalogItem(itemType, itemNo);
      if (!catalogItem) {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "NO_MATCHES",
          evidence: [],
          diagnosticStatus: "ITEM_NOT_FOUND",
          queriesAttempted,
          telemetry: {
            itemChecked: itemNo,
            itemType,
            existsInCatalog: false,
            durationMs: Date.now() - startTime,
          },
        };
      }

      // 5. Query all 4 price guide modes in parallel
      const modes: { guideType: BrickLinkGuideType; condition: BrickLinkCondition }[] = [
        { guideType: "sold", condition: "N" },
        { guideType: "sold", condition: "U" },
        { guideType: "stock", condition: "N" },
        { guideType: "stock", condition: "U" },
      ];

      const guidePromises = modes.map((mode) =>
        this.client.getPriceGuide({
          itemType,
          itemNo,
          guideType: mode.guideType,
          condition: mode.condition,
        })
      );

      const guideResults = await Promise.allSettled(guidePromises);

      const aggregateReport: BrickLinkAggregateReport = {
        itemNo,
        itemType,
        currency: "EUR",
      };

      const candidateEvidenceList: MarketEvidence[] = [];

      guideResults.forEach((res, idx) => {
        if (res.status !== "fulfilled" || !res.value) {
          return;
        }

        const guideData: BrickLinkPriceGuideResult = res.value;
        const mode = modes[idx];
        const summary = guideData.summary;

        // Record aggregate statistics for each mode
        const modeStats = {
          min: summary.minPrice,
          avg: summary.avgPrice,
          qtyAvg: summary.qtyAvgPrice,
          max: summary.maxPrice,
          unitQty: summary.unitQuantity,
          totalQty: summary.totalQuantity,
          detailCount: guideData.priceDetails.length,
        };

        if (mode.guideType === "sold" && mode.condition === "N") {
          aggregateReport.soldNew = modeStats;
        } else if (mode.guideType === "sold" && mode.condition === "U") {
          aggregateReport.soldUsed = modeStats;
        } else if (mode.guideType === "stock" && mode.condition === "N") {
          aggregateReport.stockNew = modeStats;
        } else if (mode.guideType === "stock" && mode.condition === "U") {
          aggregateReport.stockUsed = modeStats;
        }

        // Map internal condition: BrickLink N -> NEW_SEALED, U -> USED_COMPLETE
        const internalCondition = mode.condition === "N" ? "NEW_SEALED" : "USED_COMPLETE";
        const isSold = mode.guideType === "sold";
        const saleType = isSold ? "SOLD" : "ACTIVE_LISTING";

        // Process individual order / stock entries
        for (const entry of guideData.priceDetails) {
          const fingerprint = generateBrickLinkObservationFingerprint({
            itemType,
            itemNo,
            guideType: mode.guideType,
            condition: mode.condition,
            unitPrice: entry.unitPrice,
            quantity: entry.quantity,
            dateOrdered: entry.dateOrdered,
            sellerCountryCode: entry.sellerCountryCode,
            buyerCountryCode: entry.buyerCountryCode,
          });

          // Specific URL with deterministic fingerprint anchor
          const externalUrl = `${catalogBaseUrl}#sale=${fingerprint}`;

          const candidate = EvidenceValidator.validateCandidate({
            provider: this.id,
            marketplace: "BRICKLINK",
            title: `LEGO ${itemType === "PART" ? "Part" : "Set"} ${product.canonicalIdentifier} - BrickLink ${isSold ? "Sold" : "Stock"} (${mode.condition === "N" ? "New" : "Used"}): ${catalogItem.name || product.canonicalIdentifier}`,
            price: entry.unitPrice,
            currency: summary.currencyCode || "EUR",
            saleType,
            seller: null, // Strictly null; no fake "BrickLink Verified Order"
            externalUrl,
            observedAt: entry.dateOrdered || new Date(),
            canonicalIdentifier: product.canonicalIdentifier,
            productName: catalogItem.name || product.name,
            condition: internalCondition,
            provenance: ObservationProvenance.LIVE_API,
            rawMetadata: {
              fingerprint,
              bricklinkItemNo: itemNo,
              bricklinkItemType: itemType,
              guideType: mode.guideType,
              bricklinkCondition: mode.condition,
              internalCondition,
              quantity: entry.quantity,
              sellerCountryCode: entry.sellerCountryCode || null,
              buyerCountryCode: entry.buyerCountryCode || null,
              shippingAvailable: entry.shippingAvailable,
              vatIncluded: false,
              priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
              urlGranularity: "CATALOG_PRICE_GUIDE",
              summaryStats: modeStats,
            },
          });

          if (candidate) {
            candidateEvidenceList.push(candidate);
          }
        }
      });

      const durationMs = Date.now() - startTime;
      const status = candidateEvidenceList.length > 0 ? "SUCCESS" : "NO_MATCHES";

      return {
        providerId: this.id,
        providerName: this.name,
        status,
        diagnosticStatus: candidateEvidenceList.length > 0 ? "LIVE_SUCCESS" : "LIVE_NO_MATCHES",
        evidence: candidateEvidenceList,
        queriesAttempted,
        telemetry: {
          itemChecked: itemNo,
          itemType,
          catalogName: catalogItem.name,
          aggregates: aggregateReport,
          totalObservations: candidateEvidenceList.length,
          soldObservations: candidateEvidenceList.filter(e => e.saleType === "SOLD").length,
          stockObservations: candidateEvidenceList.filter(e => e.saleType === "ACTIVE_LISTING").length,
          durationMs,
        },
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);

      let diagStatus: string = "FAILED";
      if (msg.includes("401") || msg.includes("403") || msg.includes("authentication failed")) {
        diagStatus = "AUTH_FAILED";
      } else if (msg.includes("429") || msg.includes("rate limit")) {
        diagStatus = "RATE_LIMITED";
      }

      console.error(`[BrickLinkProvider] Failed querying ${itemNo}:`, err);

      return {
        providerId: this.id,
        providerName: this.name,
        status: "FAILED",
        diagnosticStatus: diagStatus,
        evidence: [],
        error: msg,
        queriesAttempted,
        telemetry: {
          itemChecked: itemNo,
          itemType,
          diagnosticStatus: diagStatus,
          durationMs,
        },
      };
    }
  }
}
