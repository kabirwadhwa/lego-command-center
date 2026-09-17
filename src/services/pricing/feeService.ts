export interface MarketplaceFeeStructure {
  channel: string;
  variableFeePct: number; // e.g. 0.15 for 15%
  fixedFee: number;       // e.g. 0.30 EUR
  estimatedShipping: number; // e.g. 6.50 EUR
  pricingEconomicsAvailable: boolean;
  liveMarketDataIntegrationAvailable: boolean;
  liveMarketDataSource?: string;
  description: string;
}

export const MARKETPLACE_FEES: Record<string, MarketplaceFeeStructure> = {
  CATAWIKI: {
    channel: "CATAWIKI",
    variableFeePct: 0.125, // 12.5% seller commission
    fixedFee: 0.00,
    estimatedShipping: 0.00, // Outbound shipping paid by buyer
    pricingEconomicsAvailable: true,
    liveMarketDataIntegrationAvailable: true,
    liveMarketDataSource: "Catawiki Live Auction Scraper (LIVE_SCRAPE)",
    description: "12.5% seller commission (shipping paid by buyer)",
  },
  SHOPIFY: {
    channel: "SHOPIFY",
    variableFeePct: 0.029, // 2.9% transaction & payment processing
    fixedFee: 0.30,
    estimatedShipping: 0.00, // Typically customer-paid shipping at checkout
    pricingEconomicsAvailable: true,
    liveMarketDataIntegrationAvailable: false,
    description: "2.9% + €0.30 payment gateway (customer pays shipping)",
  },
  BOL: {
    channel: "BOL",
    variableFeePct: 0.15, // 15% category commission
    fixedFee: 0.00,
    estimatedShipping: 6.50, // Standard Dutch/Belgian parcel delivery
    pricingEconomicsAvailable: true,
    liveMarketDataIntegrationAvailable: false,
    description: "15% category commission + €6.50 estimated parcel postage",
  },
  EBAY: {
    channel: "EBAY",
    variableFeePct: 0.1325, // 13.25% final value fee
    fixedFee: 0.35,
    estimatedShipping: 6.50,
    pricingEconomicsAvailable: true,
    liveMarketDataIntegrationAvailable: false,
    description: "13.25% + €0.35 final value fee + €6.50 parcel postage",
  },
  BRICKLINK: {
    channel: "BRICKLINK",
    variableFeePct: 0.059, // 3% sales commission + 2.9% payment processing
    fixedFee: 0.30,
    estimatedShipping: 0.00,
    pricingEconomicsAvailable: true,
    liveMarketDataIntegrationAvailable: false,
    description: "3% commission + 2.9% + €0.30 payment processing",
  },
  DEFAULT: {
    channel: "DEFAULT",
    variableFeePct: 0.15, // 15% blended baseline
    fixedFee: 0.30,
    estimatedShipping: 0.00,
    pricingEconomicsAvailable: true,
    liveMarketDataIntegrationAvailable: false,
    description: "15% blended fee baseline + €0.30",
  },
};

export function getFeeStructure(channel?: string): MarketplaceFeeStructure {
  if (!channel) return MARKETPLACE_FEES.CATAWIKI;
  const upper = channel.toUpperCase();
  return MARKETPLACE_FEES[upper] || MARKETPLACE_FEES.DEFAULT;
}

/**
 * Calculates deterministic breakeven floor:
 * breakevenFloor = (cost + paymentFixedFee + shipping) / (1 - variableFeeRate)
 */
export function calculateBreakevenFloor(
  cost: number | null,
  feeStructure: MarketplaceFeeStructure = MARKETPLACE_FEES.DEFAULT
): number | null {
  if (cost === null || cost <= 0) return null;
  const netRequired = cost + feeStructure.fixedFee + feeStructure.estimatedShipping;
  const divisor = 1 - feeStructure.variableFeePct;
  if (divisor <= 0) return null;
  return Math.round((netRequired / divisor) * 100) / 100;
}

export interface ChannelProceedsBreakdown {
  sellingPrice: number;
  variableFeeAmount: number;
  fixedFeeAmount: number;
  totalFees: number;
  shippingCost: number;
  netProceeds: number;
  cost: number | null;
  contributionProfit: number | null;
  grossMarginPct: number | null;
  roiPct: number | null;
  breakevenPrice: number | null;
}

export function calculateChannelProceeds(
  sellingPrice: number,
  cost: number | null,
  feeStructure: MarketplaceFeeStructure
): ChannelProceedsBreakdown {
  const variableFee = Math.round((sellingPrice * feeStructure.variableFeePct) * 100) / 100;
  const fixedFee = feeStructure.fixedFee;
  const totalFees = Math.round((variableFee + fixedFee) * 100) / 100;
  const shipping = feeStructure.estimatedShipping;
  const netProceeds = Math.round((sellingPrice - totalFees - shipping) * 100) / 100;

  const hasCost = cost !== null && cost > 0;
  const contributionProfit = hasCost ? Math.round((netProceeds - cost) * 100) / 100 : null;
  const grossMarginPct = hasCost && sellingPrice > 0
    ? Math.round(((contributionProfit! / sellingPrice) * 100) * 10) / 10
    : null;
  const roiPct = hasCost && cost > 0
    ? Math.round(((contributionProfit! / cost) * 100) * 10) / 10
    : null;
  const breakeven = calculateBreakevenFloor(cost, feeStructure);

  return {
    sellingPrice,
    variableFeeAmount: variableFee,
    fixedFeeAmount: fixedFee,
    totalFees,
    shippingCost: shipping,
    netProceeds,
    cost,
    contributionProfit,
    grossMarginPct,
    roiPct,
    breakevenPrice: breakeven,
  };
}
