import { ObservationProvenance } from "@prisma/client";

export const GENUINE_PROVENANCES: readonly ObservationProvenance[] = [
  ObservationProvenance.LIVE_API,
  ObservationProvenance.LIVE_SCRAPE,
  ObservationProvenance.LIVE_SEARCH,
  ObservationProvenance.MANUAL,
  ObservationProvenance.IMPORTED,
] as const;

export interface ObservableRecord {
  provenance?: ObservationProvenance | string | null;
  price?: number | string | { toString(): string } | null;
  externalUrl?: string | null;
  seller?: string | null;
  source?: string | null;
  id?: string | null;
  title?: string | null;
}

/**
 * Single source of truth for market observation eligibility.
 * Rejects SIMULATED observations unconditionally across all application runtimes,
 * environments (production, demo, development, test), and deployment modes.
 */
export function isEligibleForRealMarketPricing(observation: ObservableRecord | null | undefined): boolean {
  if (!observation) return false;
  if (!observation.provenance) return false;

  const prov = String(observation.provenance).trim().toUpperCase();

  // Absolute Invariant: SIMULATED observations are strictly forbidden from pricing
  if (prov === "SIMULATED" || prov === ObservationProvenance.SIMULATED) {
    return false;
  }

  // Must be one of the explicitly allowed genuine provenance types
  const isGenuine = GENUINE_PROVENANCES.some((p) => p === prov);
  if (!isGenuine) {
    return false;
  }

  // Price validation: must be a finite, positive number
  if (observation.price !== undefined && observation.price !== null) {
    const numPrice = Number(observation.price);
    if (isNaN(numPrice) || numPrice <= 0 || !isFinite(numPrice)) {
      return false;
    }
  }

  // Reject any synthetic seller names
  if (typeof observation.seller === "string" && observation.seller.toLowerCase().includes("simulated")) {
    return false;
  }

  // Reject any synthetic external URLs
  if (typeof observation.externalUrl === "string" && observation.externalUrl.toLowerCase().includes("simulated")) {
    return false;
  }

  // Reject any synthetic lot IDs or titles
  if (typeof observation.id === "string" && observation.id.toLowerCase().includes("simulated")) {
    return false;
  }
  if (typeof observation.title === "string" && observation.title.toLowerCase().includes("[simulated]")) {
    return false;
  }
  if (typeof observation.source === "string" && observation.source.toLowerCase().includes("simulator")) {
    return false;
  }

  return true;
}

/**
 * Validates whether an external URL is a genuine, clickable web URL.
 * Strictly rejects simulated or synthetic URLs.
 */
export function isGenuineListingUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return false;
  }
  if (trimmed.toLowerCase().includes("simulated")) {
    return false;
  }
  return true;
}
