import { ObservationProvenance, PriceType } from "@prisma/client";
import { CatawikiScrapedLot } from "@/services/scraper/catawikiScraper";

/**
 * Isolated test fixture generator for unit testing ONLY.
 * Located in /tests/fixtures/ so production/application services have no runtime route to it.
 */
export function generateTestSimulatedLots(
  setNumber: string,
  baselineCost: number = 80.0,
  count: number = 8
): CatawikiScrapedLot[] {
  const cost = baselineCost > 0 ? baselineCost : 80.0;
  const marketMid = Math.round(cost * 1.42 * 100) / 100;
  const now = Date.now();
  const lots: CatawikiScrapedLot[] = [];

  const seed = setNumber.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  for (let i = 0; i < count; i++) {
    const spreadPct = (((seed + i * 17) % 25) - 12) / 100;
    const price = Math.round((marketMid * (1 + spreadPct)) * 100) / 100;
    const isSold = i < count - 2;
    const daysAgo = (i * 3) + 1;

    lots.push({
      externalListingId: `simulated-catawiki-lot-${setNumber}-${1000 + i}`,
      title: `[SIMULATED] LEGO Set ${setNumber} Lot #${1000 + i}`,
      price,
      priceType: isSold ? PriceType.SOLD_PRICE : PriceType.CURRENT_BID,
      currency: "EUR",
      shippingCost: 14.50,
      condition: "NEW_SEALED",
      seller: `Simulated Seller #${(seed + i) % 90 + 10}`,
      externalUrl: `https://www.catawiki.com/en/l/simulated-${setNumber}-${1000 + i}`,
      auctionEndAt: isSold ? new Date(now - daysAgo * 86400000) : new Date(now + 2 * 86400000),
      capturedAt: new Date(now - daysAgo * 86400000),
      provenance: ObservationProvenance.SIMULATED,
      provider: "simulator/test-fixture"
    });
  }

  return lots;
}
