import { ObservationProvenance } from "@prisma/client";
import { ResolvedLegoProduct } from "@/services/catalog/productIdentificationService";

export type ProviderStatus = "SUCCESS" | "NO_MATCHES" | "NOT_CONFIGURED" | "FAILED";

export type SaleType = "SOLD" | "ACTIVE_LISTING" | "AUCTION" | "UNKNOWN";

export interface MarketEvidence {
  provider: string;
  marketplace: string;
  title: string;
  price: number; // Normalized price in EUR
  originalPrice?: number;
  originalCurrency?: string;
  currency: string; // "EUR"
  shipping: number | null;
  condition: string | null;
  saleType: SaleType;
  seller: string | null;
  externalUrl: string;
  observedAt: Date | null;
  productMatchScore: number;
  provenance: ObservationProvenance;
  color?: string | null;
  rawMetadata?: Record<string, unknown>;
}

export type CatawikiDiagnosticStatus =
  | "LIVE_SUCCESS"
  | "LIVE_NO_MATCHES"
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "PROVIDER_FAILED"
  | "TIMEOUT"
  | "PARSE_FAILED"
  | "RESULTS_REJECTED";

export type CatawikiRejectionReason =
  | "IDENTIFIER_MISMATCH"
  | "INVALID_PRICE"
  | "INVALID_URL"
  | "CURRENCY_UNSUPPORTED"
  | "DUPLICATE"
  | "MISSING_REQUIRED_DATA"
  | "CONDITION_MISMATCH"
  | "NOT_COMPLETED_SALE";

export interface ProviderResult {
  providerId: string;
  providerName: string;
  status: ProviderStatus;
  evidence: MarketEvidence[];
  error?: string;
  queriesAttempted?: string[];
  diagnosticStatus?: CatawikiDiagnosticStatus | string;
  rawResultCount?: number;
  acceptedResultCount?: number;
  rejectedResultCount?: number;
  rejectionReasonCounts?: Record<string, number>;
  telemetry?: Record<string, unknown>;
}

export interface IMarketResearchProvider {
  id: string;
  name: string;
  isConfigured(): boolean;
  searchMarket(
    product: ResolvedLegoProduct,
    options?: { forceRefresh?: boolean }
  ): Promise<ProviderResult>;
}
