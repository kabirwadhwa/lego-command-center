import { SyncStatus } from "@prisma/client";

export interface MarketplaceOrder {
  externalOrderId: string;
  customerName?: string;
  email?: string;
  orderDate: Date;
  items: {
    sku: string;
    quantity: number;
    unitSalePrice: number;
  }[];
  grossRevenue: number;
  marketplaceFees: number;
  shippingRevenue: number;
  discount: number;
  netRevenue: number;
}

export interface MarketplaceListing {
  sku: string;
  externalListingId: string;
  title: string;
  price: number;
  quantity: number;
  listingUrl?: string;
  status: string;
  
  // Catawiki specific fields
  catawikiCurrentBid?: number;
  catawikiReserve?: number;
  catawikiBuyNow?: number;
  catawikiAuctionEnd?: Date;
}

export interface MarketplacePriceObservation {
  sku: string;
  price: number;
  currency: string;
  shipping?: number;
  priceType: "ASKING_PRICE" | "BUY_NOW" | "CURRENT_BID" | "SOLD_PRICE";
  condition: string;
  timestamp: Date;
  seller?: string;
  listingUrl?: string;
}

export interface MarketplaceAdapter {
  getOrders(): Promise<MarketplaceOrder[]>;
  getOrder(externalOrderId: string): Promise<MarketplaceOrder | null>;
  syncInventory(sku: string, quantity: number): Promise<{ success: boolean; status: SyncStatus; error?: string }>;
  getListing(externalListingId: string): Promise<MarketplaceListing | null>;
  getListings(): Promise<MarketplaceListing[]>;
  getMarketPrices(sku: string): Promise<MarketplacePriceObservation[]>;
  
  supportsOrders(): boolean;
  supportsInventorySync(): boolean;
  supportsPricing(): boolean;
  supportsWebhooks(): boolean;
}
