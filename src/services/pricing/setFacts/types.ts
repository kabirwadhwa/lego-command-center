/**
 * Canonical "set facts" shape backing the bulk lot analysis engine.
 *
 * HARD RULE: every field is nullable and `null` means "we do not know".
 * Nothing in this pipeline may substitute 0, an estimate, an average or a
 * modelled value for a missing fact. A missing value is reported as missing.
 *
 * There are deliberately NO shipping, packaging, handling or fee fields here.
 * The lot analysis quotes real figures only (RRP, market value, what the
 * client actually paid). Selling-cost modelling lives in feeService.ts and is
 * used by the per-channel recommendation engine, never by this engine.
 */

/** Why a retail price is absent. Distinguishes "free set" from "unknown". */
export type RrpBasis =
  /** A real retail price is known. */
  | "RETAIL_PRICE"
  /** Set was never sold: gift-with-purchase / promotional. RRP is not 0, it does not exist. */
  | "FREE_PROMOTIONAL"
  /** Source carried no retail price for this set. */
  | "UNKNOWN";

/** Lifecycle status as reported by the source, normalised. */
export type SetStatus =
  | "RETAIL"
  | "RETIRING_SOON"
  | "RETIRED"
  | "UNKNOWN";

/** Which figure the "current value" came from. */
export type ValueBasis =
  /** Source published a market value for a new/sealed copy. */
  | "MARKET_VALUE_NEW"
  /** Still at retail with no secondary market value: the retail price is the current value. */
  | "RETAIL_PRICE"
  /**
   * Median of real sold observations gathered across the web, used only when
   * no catalogue value exists. The observation count and the marketplaces are
   * recorded alongside it; it is measured, not modelled.
   */
  | "WEB_EVIDENCE_MEDIAN"
  /** No value available from any source. */
  | "NONE";

export interface FieldSource {
  field: string;
  source: string;
  url?: string | null;
}

export interface SetFacts {
  /** Canonical set number as the source reports it, e.g. "10255-1". */
  setNumber: string;
  /** What the user typed. */
  input: string;

  name: string | null;
  theme: string | null;
  subtheme: string | null;
  year: number | null;
  pieces: number | null;

  /** Recommended retail price in EUR. Null when free promotional or unknown. */
  rrp: number | null;
  rrpBasis: RrpBasis;

  releaseDate: string | null;
  retirementDate: string | null;
  status: SetStatus;

  /** Market value of a new/sealed copy in EUR. */
  currentValueNew: number | null;
  /** Market value of a used copy in EUR. */
  usedValue: number | null;
  valueBasis: ValueBasis;

  /** Percent growth of current value against RRP. Null when there is no RRP to grow from. */
  growthVsRrpPct: number | null;
  /** Percent annualised growth. */
  annualGrowthPct: number | null;
  /** Published 12-month outlook, percent. */
  twelveMonthOutlookPct: number | null;

  sourceUrl: string | null;
  sources: FieldSource[];
  /** Set when the set could not be resolved at all. */
  resolutionError: string | null;

  /** How many real sold observations backed a WEB_EVIDENCE_MEDIAN value. */
  evidenceObservations?: number;
  /** Which marketplaces those observations came from. */
  evidenceMarketplaces?: string[];
}

export interface SetFactsLookup {
  facts: SetFacts | null;
  error: string | null;
}

export function emptyFacts(input: string, setNumber: string): SetFacts {
  return {
    setNumber,
    input,
    name: null,
    theme: null,
    subtheme: null,
    year: null,
    pieces: null,
    rrp: null,
    rrpBasis: "UNKNOWN",
    releaseDate: null,
    retirementDate: null,
    status: "UNKNOWN",
    currentValueNew: null,
    usedValue: null,
    valueBasis: "NONE",
    growthVsRrpPct: null,
    annualGrowthPct: null,
    twelveMonthOutlookPct: null,
    sourceUrl: null,
    sources: [],
    resolutionError: null,
  };
}
