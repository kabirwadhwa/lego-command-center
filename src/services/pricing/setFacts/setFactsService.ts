/**
 * Resolves set facts for a whole lot.
 *
 * Order of sources, best first:
 *   1. BrickEconomy — the catalogue: RRP, release/retirement, status, value,
 *      used value, growth. This is the only source that carries all of them.
 *   2. Web search across marketplaces — used ONLY to fill a missing current
 *      value, and only from real sold observations. The median is reported
 *      with its observation count and the marketplaces behind it, so the
 *      client can see it is measured rather than modelled.
 *
 * A set that neither source can price is returned with nulls and a reason.
 * Nothing is estimated, averaged across other sets, or carried over.
 */

import { SetFacts, emptyFacts } from "./types";
import { Fetcher, baseSetNumber, fetchSetFacts } from "./brickEconomyClient";
import { SET_FACTS_SEED } from "./setFactsSeed";

export interface EvidenceValuation {
  /** Median of real sold observations, in EUR. */
  median: number | null;
  observations: number;
  marketplaces: string[];
}

export type EvidenceLookup = (facts: SetFacts) => Promise<EvidenceValuation>;

export interface LookupOptions {
  fetcher?: Fetcher;
  /** Parallel lookups. Kept modest to stay polite to the source. */
  concurrency?: number;
  /** Cache lifetime. Prices move slowly; the default is 6 hours. */
  ttlMs?: number;
  forceRefresh?: boolean;
  /** Supply to enable the web-search fallback for missing values. */
  evidenceLookup?: EvidenceLookup;
  onProgress?: (done: number, total: number) => void;
}

interface CacheEntry {
  facts: SetFacts;
  at: number;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export function clearSetFactsCache(): void {
  cache.clear();
}

/** Runs tasks with a fixed ceiling on parallelism. */
async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Looks up one set, applying the web-search fallback when the catalogue has no
 * current value. Never throws: a failure is recorded on the facts object.
 */
export async function lookupSet(input: string, options: LookupOptions = {}): Promise<SetFacts> {
  const key = baseSetNumber(input);
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;

  if (!options.forceRefresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) {
      return { ...hit.facts, input };
    }

    // Served first: a cache of real catalogue data captured ahead of time.
    // This is what lets the hosted app return real values even when its
    // datacenter IP is challenged by the source. The live fetch below still
    // runs for anything not seeded, and forceRefresh skips the seed entirely.
    const seeded = SET_FACTS_SEED[key];
    if (seeded) {
      return { ...seeded, input };
    }
  }

  let facts: SetFacts;
  try {
    facts = await fetchSetFacts(input, options.fetcher);
  } catch (err) {
    facts = emptyFacts(input, key);
    facts.resolutionError = `Lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Fill a missing value from real sold observations across the web.
  if (facts.currentValueNew === null && options.evidenceLookup) {
    try {
      const ev = await options.evidenceLookup(facts);
      if (ev.median !== null && ev.observations > 0) {
        facts.currentValueNew = ev.median;
        facts.valueBasis = "WEB_EVIDENCE_MEDIAN";
        facts.evidenceObservations = ev.observations;
        facts.evidenceMarketplaces = ev.marketplaces;
        facts.sources.push({
          field: "currentValueNew",
          source: `Web search (${ev.observations} sold observations: ${ev.marketplaces.join(", ")})`,
        });
        // A value found this way clears a "not found" error only if the
        // catalogue lookup was the thing that failed, not the parse.
        if (facts.resolutionError === "Not found on BrickEconomy") {
          facts.resolutionError = null;
        }
      }
    } catch {
      // Fallback is best-effort; the catalogue result stands.
    }
  }

  cache.set(key, { facts, at: Date.now() });
  return facts;
}

/**
 * Looks up every set in a lot. Duplicated set numbers are fetched once and
 * shared, so a 200-row sheet with repeats costs one request per distinct set.
 *
 * Keyed by the exact string the caller passed in, so analysis rows can find
 * their facts even when two rows spell the same set differently.
 */
export async function lookupSets(
  inputs: string[],
  options: LookupOptions = {}
): Promise<Map<string, SetFacts>> {
  const byInput = new Map<string, SetFacts>();

  const distinct = [...new Set(inputs.map((i) => baseSetNumber(i)).filter((k) => k.length > 0))];
  let done = 0;

  const fetched = await pool(distinct, options.concurrency ?? 4, async (key) => {
    const facts = await lookupSet(key, options);
    done += 1;
    options.onProgress?.(done, distinct.length);
    return facts;
  });

  const byKey = new Map<string, SetFacts>();
  distinct.forEach((key, i) => byKey.set(key, fetched[i]));

  for (const input of inputs) {
    const key = baseSetNumber(input);
    const facts = byKey.get(key);
    if (facts) {
      byInput.set(input, { ...facts, input });
    } else {
      const empty = emptyFacts(input, key || input);
      empty.resolutionError = "Not a recognisable set number";
      byInput.set(input, empty);
    }
  }

  return byInput;
}

/* ------------------------------------------------------------------ */
/* Web search valuation, built on the existing provider stack          */
/* ------------------------------------------------------------------ */

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(m * 100) / 100;
}

/**
 * Builds an EvidenceLookup from the multi-source provider orchestrator
 * (Catawiki, eBay, BrickLink, web search). Only completed sales of
 * new/sealed copies are counted; active asking prices are not sales.
 *
 * Imported lazily so the pure analysis path stays free of Prisma.
 */
/**
 * Hosts whose pages are actual marketplace listings, so a price on them is a
 * real transaction or a real asking price.
 *
 * This allowlist exists because a general web search also returns valuation
 * blogs and price-aggregator pages. Those publish their OWN estimates, and
 * `classifySaleType` marks anything containing the word "sold" as a completed
 * sale — so a page titled "Real eBay Sold Prices" would otherwise be recorded
 * as a sold observation and another site's estimate would become our value.
 * Aggregators are still returned to the research view as references; they are
 * just not allowed to set a price.
 */
export const VALUATION_HOSTS = [
  "ebay.",
  "bricklink.com",
  "catawiki.",
  "marktplaats.nl",
  "2dehands.be",
  "vinted.",
  "bol.com",
  "amazon.",
  "kaufland.",
  "brickowl.com",
];

export function isValuationHost(marketplaceOrUrl: string | null | undefined): boolean {
  if (!marketplaceOrUrl) return false;
  const s = marketplaceOrUrl.toLowerCase();
  return VALUATION_HOSTS.some((h) => s.includes(h));
}

/**
 * EUR only. The repo's FX table (`FX_RATES_TO_EUR` in evidenceValidator.ts) is
 * a set of hardcoded constants, so converting a USD listing would import a
 * stale rate into the client's valuation. The client's own market is EUR, so
 * non-EUR observations are counted as references rather than priced in.
 */
export function isEurObservation(originalCurrency?: string | null): boolean {
  return !originalCurrency || originalCurrency.toUpperCase() === "EUR";
}

export function createEvidenceLookup(): EvidenceLookup {
  return async (facts: SetFacts): Promise<EvidenceValuation> => {
    const { MultiSourceProviderOrchestrator } = await import("../providers/providerOrchestrator");
    const orchestrator = new MultiSourceProviderOrchestrator();

    const result = await orchestrator.searchAllProviders({
      input: facts.input,
      identifierType: "LEGO_SET",
      canonicalIdentifier: baseSetNumber(facts.setNumber || facts.input),
      name: facts.name,
      theme: facts.theme,
      year: facts.year,
      imageUrl: null,
      ean: null,
      identificationSources: [],
      identificationConfidence: null,
    });

    const usable = result.evidenceByCondition.newSealed.filter(
      (e) =>
        (e.saleType === "SOLD" || e.saleType === "AUCTION") &&
        isEurObservation(e.originalCurrency) &&
        (isValuationHost(e.marketplace) || isValuationHost(e.externalUrl))
    );

    return {
      median: median(usable.map((e) => e.price)),
      observations: usable.length,
      marketplaces: [...new Set(usable.map((e) => e.marketplace))].slice(0, 6),
    };
  };
}
