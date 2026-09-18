import { ObservationProvenance } from "@prisma/client";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";
import { IMarketResearchProvider, MarketEvidence, ProviderResult, SaleType } from "./types";
import { EvidenceValidator } from "./evidenceValidator";

export class EbayProvider implements IMarketResearchProvider {
  id = "ebay";
  name = "eBay Marketplace";

  isConfigured(): boolean {
    return !!(process.env.EBAY_APP_ID || process.env.EBAY_API_KEY);
  }

  async searchMarket(
    product: ResolvedLegoProduct
  ): Promise<ProviderResult> {
    if (!this.isConfigured()) {
      return {
        providerId: this.id,
        providerName: this.name,
        status: "NOT_CONFIGURED",
        evidence: [],
        error: "eBay integration unconfigured: EBAY_APP_ID environment variable is missing.",
      };
    }

    const appId = process.env.EBAY_APP_ID || process.env.EBAY_API_KEY;
    const query = product.identifierType === "LEGO_PART"
      ? `LEGO part ${product.canonicalIdentifier}`
      : `LEGO ${product.canonicalIdentifier}`;

    const queriesAttempted = [query];

    try {
      // Query eBay Finding Service for completed items (sold)
      const url = `https://svcs.ebay.com/services/search/FindingService/v1?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.13.0&SECURITY-APPNAME=${appId}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD&keywords=${encodeURIComponent(query)}&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true&paginationInput.entriesPerPage=20`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`eBay API returned HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      const items = json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];

      if (!Array.isArray(items) || items.length === 0) {
        return {
          providerId: this.id,
          providerName: this.name,
          status: "NO_MATCHES",
          evidence: [],
          queriesAttempted,
        };
      }

      const validatedEvidence: MarketEvidence[] = [];

      for (const it of items) {
        const title = it.title?.[0] || "";
        const viewUrl = it.viewItemURL?.[0] || "";
        const sellingStatus = it.sellingStatus?.[0];
        const currentPrice = sellingStatus?.currentPrice?.[0];
        const priceVal = currentPrice?.__value__ ? parseFloat(currentPrice.__value__) : null;
        const currency = currentPrice?.["@currencyId"] || "EUR";
        const sellerInfo = it.sellerInfo?.[0]?.sellerUserName?.[0] || null;
        const endTime = it.listingInfo?.[0]?.endTime?.[0] ? new Date(it.listingInfo[0].endTime[0]) : new Date();

        const candidate = EvidenceValidator.validateCandidate({
          provider: this.id,
          marketplace: "EBAY",
          title,
          price: priceVal,
          currency,
          saleType: "SOLD" as SaleType,
          seller: sellerInfo,
          externalUrl: viewUrl,
          observedAt: endTime,
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
      console.error(`[EbayProvider] Query failed for ${query}:`, err);
      return {
        providerId: this.id,
        providerName: this.name,
        status: "FAILED",
        evidence: [],
        error: err instanceof Error ? err.message : "eBay API request failed",
        queriesAttempted,
      };
    }
  }
}
