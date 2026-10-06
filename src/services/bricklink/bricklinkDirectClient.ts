import {
  BrickLinkItemType,
  BrickLinkPriceGuideSummary,
  parseStrictInteger,
} from "./bricklinkClient";

export interface BrickLinkDirectItem {
  idItem: number;
  itemNo: string;
  itemName: string;
  itemType: BrickLinkItemType;
  categoryId?: string;
  newMinPrice?: number | null;
  newMaxPrice?: number | null;
  newQty?: number;
  newSellerCount?: number;
  usedMinPrice?: number | null;
  usedMaxPrice?: number | null;
  usedQty?: number;
  usedSellerCount?: number;
}

export interface BrickLinkDirectListing {
  idInv: number;
  codeNew: "N" | "U";
  codeComplete: "S" | "C" | "B";
  unitPrice: number;
  currency: string;
  quantity: number;
  storeName: string;
  sellerUsername: string;
  sellerFeedbackScore: number;
  sellerCountryCode: string;
  description: string;
}

export interface BrickLinkDirectSaleTransaction {
  quantity: number;
  unitPrice: number;
  currency: string;
  condition: "N" | "U";
  dateOrdered: Date;
}

export interface BrickLinkDirectPriceGuideData {
  item: BrickLinkDirectItem;
  soldNewSummary: BrickLinkPriceGuideSummary;
  soldUsedSummary: BrickLinkPriceGuideSummary;
  stockNewSummary: BrickLinkPriceGuideSummary;
  stockUsedSummary: BrickLinkPriceGuideSummary;
  soldTransactions: BrickLinkDirectSaleTransaction[];
  activeListings: BrickLinkDirectListing[];
}

const MONTH_MAP: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/**
 * Parses raw BrickLink price string like "EUR 649.99", "~EUR 576.24", "US $1,999.00".
 */
export function parseBrickLinkPriceString(str: string | null | undefined): { price: number; currency: string } | null {
  if (!str) return null;
  const clean = str.replace(/[~]/g, "").trim();
  const m = clean.match(/^([A-Za-z$ ]+?)\s*([\d,]+\.?\d*)$/);
  if (!m) return null;
  const rawCurr = m[1].trim();
  const price = parseFloat(m[2].replace(/,/g, ""));
  if (isNaN(price) || !isFinite(price) || price < 0) return null;

  let currency = "EUR";
  if (rawCurr.includes("EUR")) currency = "EUR";
  else if (rawCurr.includes("US") || rawCurr.includes("$")) currency = "USD";
  else if (rawCurr.includes("GBP") || rawCurr.includes("£")) currency = "GBP";
  else if (rawCurr) currency = rawCurr;

  return { price, currency };
}

/**
 * Parses BrickLink month header string like "September 2026".
 */
export function parseBrickLinkMonthHeader(str: string | null | undefined): Date | null {
  if (!str) return null;
  const parts = str.trim().toLowerCase().split(/\s+/);
  if (parts.length === 2 && MONTH_MAP[parts[0]] !== undefined) {
    const year = parseInt(parts[1], 10);
    const month = MONTH_MAP[parts[0]];
    if (!isNaN(year) && year >= 1990 && year <= 2100) {
      return new Date(Date.UTC(year, month, 15));
    }
  }
  return null;
}

export class BrickLinkDirectClient {
  private defaultCurrency: "EUR" | "USD";
  private userAgent: string;

  constructor(options?: { defaultCurrency?: "EUR" | "USD"; userAgent?: string }) {
    this.defaultCurrency = options?.defaultCurrency || "EUR";
    this.userAgent =
      options?.userAgent ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  }

  /**
   * Resolves a LEGO item identifier (e.g. "10316", "75192-1", "3001") to BrickLink's internal idItem
   * via BrickLink's searchproduct.ajax endpoint.
   */
  async resolveItem(query: string, preferredType?: BrickLinkItemType): Promise<BrickLinkDirectItem | null> {
    const cleanQuery = query.trim();
    const url = `https://www.bricklink.com/ajax/clone/search/searchproduct.ajax?q=${encodeURIComponent(cleanQuery)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!res.ok) {
      throw new Error(`BrickLink search request failed with HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data || data.returnCode !== 0 || !data.result || !Array.isArray(data.result.typeList)) {
      return null;
    }

    const typeList: Array<{
      type: string;
      count: number;
      items?: Array<{
        idItem: number;
        typeItem: string;
        strItemNo: string;
        strItemName: string;
        strCategory?: string;
        mNewMinPrice?: string;
        mNewMaxPrice?: string;
        n4NewQty?: number;
        n4NewSellerCnt?: number;
        mUsedMinPrice?: string;
        mUsedMaxPrice?: string;
        n4UsedQty?: number;
        n4UsedSellerCnt?: number;
      }>;
    }> = data.result.typeList;

    // Filter by type if provided: SET -> "S", PART -> "P", MINIFIG -> "M"
    const targetTypeKey = preferredType === "PART" ? "P" : preferredType === "MINIFIG" ? "M" : "S";

    // 1. Try exact type first
    let candidateType = typeList.find((t) => t.type === targetTypeKey && Array.isArray(t.items) && t.items.length > 0);
    // 2. If not found, check other types
    if (!candidateType) {
      candidateType = typeList.find((t) => Array.isArray(t.items) && t.items.length > 0);
    }

    if (!candidateType || !candidateType.items || candidateType.items.length === 0) {
      return null;
    }

    // Find best item match in candidate items
    const queryWithoutSuffix = cleanQuery.replace(/-[0-9]+$/, "").toLowerCase();
    const exactMatch = candidateType.items.find(
      (item) =>
        item.strItemNo.toLowerCase() === cleanQuery.toLowerCase() ||
        item.strItemNo.toLowerCase() === `${cleanQuery.toLowerCase()}-1` ||
        item.strItemNo.toLowerCase().replace(/-[0-9]+$/, "") === queryWithoutSuffix
    ) || candidateType.items[0];

    const parsedNewMin = parseBrickLinkPriceString(exactMatch.mNewMinPrice);
    const parsedNewMax = parseBrickLinkPriceString(exactMatch.mNewMaxPrice);
    const parsedUsedMin = parseBrickLinkPriceString(exactMatch.mUsedMinPrice);
    const parsedUsedMax = parseBrickLinkPriceString(exactMatch.mUsedMaxPrice);

    const mappedType: BrickLinkItemType =
      exactMatch.typeItem === "P"
        ? "PART"
        : exactMatch.typeItem === "M"
        ? "MINIFIG"
        : exactMatch.typeItem === "B"
        ? "BOOK"
        : exactMatch.typeItem === "G"
        ? "GEAR"
        : exactMatch.typeItem === "I"
        ? "INSTRUCTION"
        : exactMatch.typeItem === "C"
        ? "CATALOG"
        : "SET";

    return {
      idItem: exactMatch.idItem,
      itemNo: exactMatch.strItemNo,
      itemName: exactMatch.strItemName,
      itemType: mappedType,
      categoryId: exactMatch.strCategory,
      newMinPrice: parsedNewMin?.price ?? null,
      newMaxPrice: parsedNewMax?.price ?? null,
      newQty: exactMatch.n4NewQty || 0,
      newSellerCount: exactMatch.n4NewSellerCnt || 0,
      usedMinPrice: parsedUsedMin?.price ?? null,
      usedMaxPrice: parsedUsedMax?.price ?? null,
      usedQty: exactMatch.n4UsedQty || 0,
      usedSellerCount: exactMatch.n4UsedSellerCnt || 0,
    };
  }

  /**
   * Fetches and parses the Price Guide tab (catalogitem_pgtab.page) for an item.
   * Returns complete 6-month sold statistics, current stock statistics, and individual sold transaction rows.
   */
  async fetchPriceGuideTab(
    idItem: number,
    item: BrickLinkDirectItem,
    currencyCode: "EUR" | "USD" = this.defaultCurrency
  ): Promise<{
    soldNewSummary: BrickLinkPriceGuideSummary;
    soldUsedSummary: BrickLinkPriceGuideSummary;
    stockNewSummary: BrickLinkPriceGuideSummary;
    stockUsedSummary: BrickLinkPriceGuideSummary;
    soldTransactions: BrickLinkDirectSaleTransaction[];
  }> {
    const currencyParam = currencyCode === "USD" ? 1 : 2;
    const url = `https://www.bricklink.com/v2/catalog/catalogitem_pgtab.page?idItem=${idItem}&currency=${currencyParam}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`BrickLink Price Guide tab request failed with HTTP ${res.status}`);
    }

    const html = await res.text();

    // 1. Parse the 4 pcipgSummaryTable instances:
    // [0] = Sold New, [1] = Sold Used, [2] = Stock New, [3] = Stock Used
    const summaryMatches = [...html.matchAll(/<TABLE[^>]*CLASS=["']?pcipgSummaryTable["']?[^>]*>([\s\S]*?)<\/TABLE>/gi)];

    const parseSummaryTable = (
      tableHtml: string | undefined,
      guideType: "sold" | "stock",
      condition: "N" | "U"
    ): BrickLinkPriceGuideSummary => {
      const getVal = (label: string): string | null => {
        if (!tableHtml) return null;
        const reg = new RegExp(`<TD>\\s*${label}\\s*<\\/TD>\\s*<TD>\\s*<b>([^<]+)<\\/b>`, "i");
        const m = tableHtml.match(reg);
        return m ? m[1].trim() : null;
      };

      const minParsed = parseBrickLinkPriceString(getVal("Min Price:"));
      const avgParsed = parseBrickLinkPriceString(getVal("Avg Price:"));
      const qtyAvgParsed = parseBrickLinkPriceString(getVal("Qty Avg Price:"));
      const maxParsed = parseBrickLinkPriceString(getVal("Max Price:"));

      const unitQtyStr = guideType === "sold" ? getVal("Times Sold:") : getVal("Total Lots:");
      const totalQtyStr = getVal("Total Qty:");

      return {
        itemNo: item.itemNo,
        itemType: item.itemType,
        guideType,
        condition,
        currencyCode,
        minPrice: minParsed?.price ?? null,
        avgPrice: avgParsed?.price ?? null,
        qtyAvgPrice: qtyAvgParsed?.price ?? null,
        maxPrice: maxParsed?.price ?? null,
        unitQuantity: parseStrictInteger(unitQtyStr),
        totalQuantity: parseStrictInteger(totalQtyStr),
        vatIncluded: false,
        priceBasis: "EX_VAT_BRICKLINK_PRICE_GUIDE",
      };
    };

    const soldNewSummary = parseSummaryTable(summaryMatches[0]?.[1], "sold", "N");
    const soldUsedSummary = parseSummaryTable(summaryMatches[1]?.[1], "sold", "U");
    const stockNewSummary = parseSummaryTable(summaryMatches[2]?.[1], "stock", "N");
    const stockUsedSummary = parseSummaryTable(summaryMatches[3]?.[1], "stock", "U");

    // 2. Parse individual completed sales transactions from pcipgInnerTable:
    // Inner table [0] = Sold New transactions, [1] = Sold Used transactions
    const innerMatches = [...html.matchAll(/<TABLE[^>]*CLASS=["']?pcipgInnerTable["']?[^>]*>([\s\S]*?)<\/TABLE>/gi)];
    const soldTransactions: BrickLinkDirectSaleTransaction[] = [];

    const parseTransactions = (innerHtml: string | undefined, condition: "N" | "U") => {
      if (!innerHtml) return;
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let m: RegExpExecArray | null;
      let currentMonthDate: Date | null = null;
      let count = 0;
      const maxTransactionsPerCondition = 100;

      while ((m = rowRegex.exec(innerHtml)) !== null) {
        if (count >= maxTransactionsPerCondition) break;
        const content = m[1];
        // Check for month header: class="pcipgSubHeader"><b>September 2026</b>
        const mHeader = content.match(/class=["']?pcipgSubHeader["']?[^>]*><b>([^<]+)<\/b>/i);
        if (mHeader) {
          const parsedDate = parseBrickLinkMonthHeader(mHeader[1]);
          if (parsedDate) {
            currentMonthDate = parsedDate;
          }
          continue;
        }

        // Skip non-transaction rows (totals, table headers, spacers)
        if (
          content.includes("Total Lots:") ||
          content.includes("Total Qty:") ||
          content.includes("<b>Qty</b>") ||
          content.includes("&nbsp;")
        ) {
          continue;
        }

        // Match table cells: <td></td><td>1</td><td>EUR 649.99</td>
        const cells = [...content.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1].trim());
        if (cells.length >= 3) {
          const qty = parseInt(cells[1], 10);
          const priceObj = parseBrickLinkPriceString(cells[2]);
          if (!isNaN(qty) && qty > 0 && priceObj && priceObj.price > 0) {
            soldTransactions.push({
              quantity: qty,
              unitPrice: priceObj.price,
              currency: priceObj.currency || currencyCode,
              condition,
              dateOrdered: currentMonthDate || new Date(),
            });
            count++;
          }
        }
      }
    };

    if (innerMatches.length >= 1) {
      parseTransactions(innerMatches[0]?.[1], "N");
    }
    if (innerMatches.length >= 2) {
      parseTransactions(innerMatches[1]?.[1], "U");
    }

    return {
      soldNewSummary,
      soldUsedSummary,
      stockNewSummary,
      stockUsedSummary,
      soldTransactions,
    };
  }

  /**
   * Fetches active inventory listings for an item via catalogifs.ajax.
   */
  async fetchActiveListings(
    idItem: number,
    condition: "N" | "U",
    rpp: number = 50
  ): Promise<BrickLinkDirectListing[]> {
    const url = `https://www.bricklink.com/ajax/clone/catalogifs.ajax?itemid=${idItem}&cond=${condition}&rpp=${rpp}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!res.ok) {
      throw new Error(`BrickLink catalogifs request failed with HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data || data.returnCode !== 0 || !Array.isArray(data.list)) {
      return [];
    }

    const listings: BrickLinkDirectListing[] = [];
    for (const raw of data.list) {
      const priceObj = parseBrickLinkPriceString(raw.mDisplaySalePrice) || parseBrickLinkPriceString(raw.mInvSalePrice);
      if (!priceObj || priceObj.price <= 0) continue;

      const codeComplete = (raw.codeComplete === "S" || raw.codeComplete === "C" || raw.codeComplete === "B")
        ? raw.codeComplete
        : "C";

      listings.push({
        idInv: parseStrictInteger(raw.idInv),
        codeNew: raw.codeNew === "N" ? "N" : "U",
        codeComplete,
        unitPrice: priceObj.price,
        currency: priceObj.currency || this.defaultCurrency,
        quantity: parseStrictInteger(raw.n4Qty) || 1,
        storeName: String(raw.strStorename || "").trim(),
        sellerUsername: String(raw.strSellerUsername || "").trim(),
        sellerFeedbackScore: parseStrictInteger(raw.n4SellerFeedbackScore),
        sellerCountryCode: String(raw.strSellerCountryCode || "").trim().toUpperCase(),
        description: String(raw.strDesc || "").trim(),
      });
    }

    return listings;
  }

  /**
   * Full end-to-end lookup: resolves item, fetches 6-month price guide & completed sales,
   * and fetches active stock listings.
   */
  async getFullPriceGuideData(
    query: string,
    preferredType?: BrickLinkItemType,
    currencyCode: "EUR" | "USD" = this.defaultCurrency
  ): Promise<BrickLinkDirectPriceGuideData | null> {
    const item = await this.resolveItem(query, preferredType);
    if (!item) return null;

    const [pgResult, newStockListings, usedStockListings] = await Promise.all([
      this.fetchPriceGuideTab(item.idItem, item, currencyCode),
      this.fetchActiveListings(item.idItem, "N", 50).catch(() => []),
      this.fetchActiveListings(item.idItem, "U", 50).catch(() => []),
    ]);

    return {
      item,
      soldNewSummary: pgResult.soldNewSummary,
      soldUsedSummary: pgResult.soldUsedSummary,
      stockNewSummary: pgResult.stockNewSummary,
      stockUsedSummary: pgResult.stockUsedSummary,
      soldTransactions: pgResult.soldTransactions,
      activeListings: [...newStockListings, ...usedStockListings],
    };
  }
}
