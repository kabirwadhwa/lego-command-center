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
  marketplaceFees: number | null;
  shippingRevenue: number;
  discount: number;
  netRevenue: number | null;
}

export interface MarketplaceListing {
  sku: string;
  externalListingId: string;
  title: string;
  price: number;
  quantity: number;
  listingUrl?: string;
  status: string;

  // Shopify specific fields
  shopifyInventoryItemId?: string | null;
  shopifyLocationId?: string | null;
  
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

export type CapabilityStatus = "AVAILABLE" | "NOT_CONFIGURED" | "NOT_SUPPORTED";

export interface MarketplaceCapabilities {
  orders: CapabilityStatus;
  inventorySync: CapabilityStatus;
  pricing: CapabilityStatus;
  webhooks: CapabilityStatus;
}

export interface MarketplaceAdapter {
  getOrders(): Promise<MarketplaceOrder[]>;
  getOrder(externalOrderId: string): Promise<MarketplaceOrder | null>;
  syncInventory(sku: string, quantity: number, jobId?: string): Promise<{ success: boolean; status: SyncStatus; error?: string }>;
  getListing(externalListingId: string): Promise<MarketplaceListing | null>;
  getListings(): Promise<MarketplaceListing[]>;
  getMarketPrices(sku: string): Promise<MarketplacePriceObservation[]>;
  
  getCapabilities(): MarketplaceCapabilities;
  testConnection(): Promise<{ success: boolean; error?: string }>;
}
