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
import {
  BrickLinkDirectClient,
  BrickLinkDirectPriceGuideData,
} from "@/services/bricklink/bricklinkDirectClient";

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
  private directClient: BrickLinkDirectClient;

  constructor(customClient?: BrickLinkClient, customDirectClient?: BrickLinkDirectClient) {
    this.client = customClient || new BrickLinkClient();
    this.directClient = customDirectClient || new BrickLinkDirectClient();
  }

  isConfigured(): boolean {
    if (process.env.BRICKLINK_DISABLED === "true") {
      return false;
    }
    // Fully operational either via official OAuth or via direct price guide workaround
    return true;
  }

  isOfficialOAuthConfigured(): boolean {
    return this.client.isConfigured();
  }

  getMissingCredentials(): string[] {
    return this.client.getMissingCredentials();
  }

  async searchMarket(
    product: ResolvedLegoProduct
  ): Promise<ProviderResult> {
    const startTime = Date.now();

    // 1. Check configuration
    if (!this.isConfigured()) {
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NOT_CONFIGURED",
        evidence: [],
        error: "BrickLink provider explicitly disabled via BRICKLINK_DISABLED.",
        telemetry: {
          configured: false,
          provider: this.id,
        },
      };
    }

    // 2. Reject unsupported/unknown identifiers for official OAuth API
    // For direct workaround mode, searchproduct.ajax resolves arbitrary catalog items automatically.
    const effectiveIdentifier = product.canonicalIdentifier || product.input;
    if (!effectiveIdentifier || (product.identifierType === "UNKNOWN" && this.isOfficialOAuthConfigured())) {
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
      effectiveIdentifier,
      product.identifierType
    );

    const catalogTypeKey = itemType === "PART" ? "P" : itemType === "MINIFIG" ? "M" : "S";
    const catalogBaseUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${catalogTypeKey}=${itemNo}`;

    // Prefer official OAuth client if fully configured; otherwise execute direct price guide client
    if (this.isOfficialOAuthConfigured()) {
      return this.searchMarketViaOfficialApi(product, itemNo, itemType, catalogBaseUrl, startTime);
    } else {
      return this.searchMarketViaDirectWorkaround(product, itemNo, itemType, catalogBaseUrl, startTime);
    }
  }

  /**
   * Workaround execution branch: extracts real BrickLink market data directly via internal catalog/PG endpoints.
   */
  private async searchMarketViaDirectWorkaround(
    product: ResolvedLegoProduct,
    itemNo: string,
    itemType: BrickLinkItemType,
    catalogBaseUrl: string,
    startTime: number
  ): Promise<ProviderResult> {
    const queriesAttempted = [
      `BrickLink Catalog: ${itemType} ${itemNo} (Direct Catalog API)`,
      `BrickLink Price Guide: catalogitem_pgtab.page?idItem={idItem}&currency=2 (EUR)`,
      `BrickLink Stock Listings: catalogifs.ajax?itemid={idItem}`,
    ];

    try {
      const data: BrickLinkDirectPriceGuideData | null = await this.directClient.getFullPriceGuideData(
        product.canonicalIdentifier,
        itemType,
        "EUR"
      );

      if (!data) {
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
            authMode: "DIRECT_PRICE_GUIDE_WORKAROUND",
            existsInCatalog: false,
            durationMs: Date.now() - startTime,
          },
        };
      }

      const aggregateReport: BrickLinkAggregateReport = {
        itemNo: data.item.itemNo,
        itemType: data.item.itemType,
        currency: "EUR",
        soldNew: {
          min: data.soldNewSummary.minPrice,
          avg: data.soldNewSummary.avgPrice,
          qtyAvg: data.soldNewSummary.qtyAvgPrice,
          max: data.soldNewSummary.maxPrice,
          unitQty: data.soldNewSummary.unitQuantity,
          totalQty: data.soldNewSummary.totalQuantity,
          detailCount: data.soldTransactions.filter((t) => t.condition === "N").length,
        },
        soldUsed: {
          min: data.soldUsedSummary.minPrice,
          avg: data.soldUsedSummary.avgPrice,
          qtyAvg: data.soldUsedSummary.qtyAvgPrice,
          max: data.soldUsedSummary.maxPrice,
          unitQty: data.soldUsedSummary.unitQuantity,
          totalQty: data.soldUsedSummary.totalQuantity,
          detailCount: data.soldTransactions.filter((t) => t.condition === "U").length,
        },
        stockNew: {
          min: data.stockNewSummary.minPrice,
          avg: data.stockNewSummary.avgPrice,
          qtyAvg: data.stockNewSummary.qtyAvgPrice,
          max: data.stockNewSummary.maxPrice,
          unitQty: data.stockNewSummary.unitQuantity,
          totalQty: data.stockNewSummary.totalQuantity,
          detailCount: data.activeListings.filter((l) => l.codeNew === "N").length,
        },
        stockUsed: {
          min: data.stockUsedSummary.minPrice,
          avg: data.stockUsedSummary.avgPrice,
          qtyAvg: data.stockUsedSummary.qtyAvgPrice,
          max: data.stockUsedSummary.maxPrice,
          unitQty: data.stockUsedSummary.unitQuantity,
          totalQty: data.stockUsedSummary.totalQuantity,
          detailCount: data.activeListings.filter((l) => l.codeNew === "U").length,
        },
      };

      const candidateEvidenceList: MarketEvidence[] = [];
      const resolvedTypeKey = data.item.itemType === "PART" ? "P" : data.item.itemType === "MINIFIG" ? "M" : "S";
      const resolvedCatalogUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?${resolvedTypeKey}=${data.item.itemNo}`;
      const itemCategoryLabel = data.item.itemType === "PART" ? "Part" : data.item.itemType === "MINIFIG" ? "Minifig" : "Set";

      // 1. Process genuine completed sales transactions (6-month sales history)
      for (const t of data.soldTransactions) {
        const fingerprint = generateBrickLinkObservationFingerprint({
          itemType: data.item.itemType,
          itemNo: data.item.itemNo,
          guideType: "sold",
          condition: t.condition,
          unitPrice: t.unitPrice,
          quantity: t.quantity,
          dateOrdered: t.dateOrdered,
        });

        const externalUrl = `${resolvedCatalogUrl}#sale=${fingerprint}`;
        const internalCondition = t.condition === "N" ? "NEW_SEALED" : "USED_COMPLETE";

        const candidate = EvidenceValidator.validateCandidate({
          provider: this.id,
          marketplace: "BRICKLINK",
          title: `LEGO ${itemCategoryLabel} ${data.item.itemNo} - BrickLink Sold (${t.condition === "N" ? "New" : "Used"}): ${data.item.itemName || product.canonicalIdentifier}`,
          price: t.unitPrice,
          currency: t.currency || "EUR",
          saleType: "SOLD",
          seller: null, // Strictly null; no fabricated seller identity
          externalUrl,
          observedAt: t.dateOrdered,
          canonicalIdentifier: product.canonicalIdentifier,
          productName: data.item.itemName || product.name,
          condition: internalCondition,
          provenance: ObservationProvenance.LIVE_SCRAPE,
          rawMetadata: {
            fingerprint,
            bricklinkItemNo: data.item.itemNo,
            bricklinkItemType: data.item.itemType,
            guideType: "sold",
            bricklinkCondition: t.condition,
            internalCondition,
            quantity: t.quantity,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
            urlGranularity: "CATALOG_PRICE_GUIDE",
            sourceMode: "DIRECT_PRICE_GUIDE_WORKAROUND",
            summaryStats: t.condition === "N" ? aggregateReport.soldNew : aggregateReport.soldUsed,
          },
        });

        if (candidate) {
          candidateEvidenceList.push(candidate);
        }
      }

      // 2. Process genuine active stock listings
      for (const l of data.activeListings) {
        const internalCondition = l.codeNew === "N" ? "NEW_SEALED" : "USED_COMPLETE";
        const externalUrl = `${resolvedCatalogUrl}#inv=${l.idInv}`;

        const candidate = EvidenceValidator.validateCandidate({
          provider: this.id,
          marketplace: "BRICKLINK",
          title: `LEGO ${itemCategoryLabel} ${data.item.itemNo} - BrickLink Stock (${l.codeNew === "N" ? "New" : "Used"}): ${data.item.itemName || product.canonicalIdentifier}`,
          price: l.unitPrice,
          currency: l.currency || "EUR",
          saleType: "ACTIVE_LISTING",
          seller: l.storeName || l.sellerUsername || null,
          externalUrl,
          observedAt: new Date(),
          canonicalIdentifier: product.canonicalIdentifier,
          productName: data.item.itemName || product.name,
          condition: internalCondition,
          provenance: ObservationProvenance.LIVE_SCRAPE,
          rawMetadata: {
            idInv: l.idInv,
            storeName: l.storeName,
            sellerUsername: l.sellerUsername,
            sellerFeedbackScore: l.sellerFeedbackScore,
            sellerCountryCode: l.sellerCountryCode,
            description: l.description,
            codeComplete: l.codeComplete,
            bricklinkItemNo: data.item.itemNo,
            bricklinkItemType: data.item.itemType,
            guideType: "stock",
            bricklinkCondition: l.codeNew,
            internalCondition,
            quantity: l.quantity,
            vatIncluded: false,
            priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
            urlGranularity: "CATALOG_PRICE_GUIDE",
            sourceMode: "DIRECT_PRICE_GUIDE_WORKAROUND",
            summaryStats: l.codeNew === "N" ? aggregateReport.stockNew : aggregateReport.stockUsed,
          },
        });

        if (candidate) {
          candidateEvidenceList.push(candidate);
        }
      }

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
          itemChecked: data.item.itemNo,
          itemType: data.item.itemType,
          catalogName: data.item.itemName,
          authMode: "DIRECT_PRICE_GUIDE_WORKAROUND",
          aggregates: aggregateReport,
          totalObservations: candidateEvidenceList.length,
          soldObservations: candidateEvidenceList.filter((e) => e.saleType === "SOLD").length,
          stockObservations: candidateEvidenceList.filter((e) => e.saleType === "ACTIVE_LISTING").length,
          durationMs,
        },
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BrickLinkProvider:Direct] Failed querying ${itemNo}:`, err);

      return {
        providerId: this.id,
        providerName: this.name,
        status: "FAILED",
        diagnosticStatus: "FAILED",
        evidence: [],
        error: msg,
        queriesAttempted,
        telemetry: {
          itemChecked: itemNo,
          itemType,
          authMode: "DIRECT_PRICE_GUIDE_WORKAROUND",
          diagnosticStatus: "FAILED",
          durationMs,
        },
      };
    }
  }

  /**
   * Official API execution branch (used when official OAuth credentials are present).
   */
  private async searchMarketViaOfficialApi(
    product: ResolvedLegoProduct,
    itemNo: string,
    itemType: BrickLinkItemType,
    catalogBaseUrl: string,
    startTime: number
  ): Promise<ProviderResult> {
    const queriesAttempted = [
      `BrickLink Catalog: ${itemType} ${itemNo}`,
      `BrickLink Price Guide: /items/${itemType}/${itemNo}/price`,
    ];

    try {
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
            authMode: "OFFICIAL_OAUTH",
            existsInCatalog: false,
            durationMs: Date.now() - startTime,
          },
        };
      }

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

        const internalCondition = mode.condition === "N" ? "NEW_SEALED" : "USED_COMPLETE";
        const isSold = mode.guideType === "sold";
        const saleType = isSold ? "SOLD" : "ACTIVE_LISTING";

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

          const externalUrl = `${catalogBaseUrl}#sale=${fingerprint}`;

          const candidate = EvidenceValidator.validateCandidate({
            provider: this.id,
            marketplace: "BRICKLINK",
            title: `LEGO ${itemType === "PART" ? "Part" : "Set"} ${product.canonicalIdentifier} - BrickLink ${isSold ? "Sold" : "Stock"} (${mode.condition === "N" ? "New" : "Used"}): ${catalogItem.name || product.canonicalIdentifier}`,
            price: entry.unitPrice,
            currency: summary.currencyCode || "EUR",
            saleType,
            seller: null,
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
              sourceMode: "OFFICIAL_OAUTH",
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
          authMode: "OFFICIAL_OAUTH",
          aggregates: aggregateReport,
          totalObservations: candidateEvidenceList.length,
          soldObservations: candidateEvidenceList.filter((e) => e.saleType === "SOLD").length,
          stockObservations: candidateEvidenceList.filter((e) => e.saleType === "ACTIVE_LISTING").length,
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

      console.error(`[BrickLinkProvider:Official] Failed querying ${itemNo}:`, err);

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
          authMode: "OFFICIAL_OAUTH",
          diagnosticStatus: diagStatus,
          durationMs,
        },
      };
    }
  }
}
