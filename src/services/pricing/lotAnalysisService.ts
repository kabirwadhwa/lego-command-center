/**
 * Bulk lot analysis: per-set rows plus a lot-level roll-up.
 *
 * ============================ THE RULES ============================
 *
 * 1. NO INVENTED COSTS. Profit is `current value - what the client actually
 *    paid`. Nothing else is ever subtracted. There is no shipping, packaging,
 *    handling, labour or fee term anywhere in this file, and none may be
 *    added. Per-channel selling costs are a separate question answered by
 *    feeService.ts for the recommendation engine, never here.
 *
 * 2. NO INVENTED ALLOCATIONS. When the client gives one price for a whole
 *    lot, that figure stays at lot level. It is NOT divided across sets or
 *    copies. Spreading a lot price per copy is what previously turned
 *    genuinely profitable lines into fake losses.
 *
 * 3. UNKNOWN IS NOT ZERO. A missing RRP, value or paid amount is reported as
 *    missing and excluded from the relevant total, with the exclusion counted
 *    and surfaced. It never becomes 0, an average or an estimate.
 *
 * 4. NO RATIO ON A ZERO BASE. A "multiple" against a paid amount of zero or
 *    unknown is undefined, not 0.00x. It is reported as not applicable.
 */

import { SetFacts, RrpBasis, SetStatus, ValueBasis } from "./setFacts/types";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface LotInputRow {
  /** What the client typed or what the spreadsheet cell held. */
  input: string;
  /** Copies owned. Defaults to 1 when the client gives no quantity. */
  owned?: number | null;
  /** Price paid per single copy, if the client supplied it. */
  paidPerSet?: number | null;
  /** Total paid for this line, if the client supplied it. */
  paidTotal?: number | null;
}

export interface LotAnalysisInput {
  rows: LotInputRow[];
  /**
   * One price covering the whole lot, when the client bought it as a job lot
   * and has no per-set breakdown. Used at lot level only (rule 2).
   */
  lotPaidTotal?: number | null;
  currency?: string;
}

/* ------------------------------------------------------------------ */
/* Outputs                                                             */
/* ------------------------------------------------------------------ */

export type PaidBasis = "SUPPLIED_TOTAL" | "SUPPLIED_PER_SET" | "SUPPLIED_ZERO" | "NOT_SUPPLIED";

export interface LotAnalysisRow {
  input: string;
  setNumber: string;
  name: string | null;
  theme: string | null;
  subtheme: string | null;
  year: number | null;
  pieces: number | null;

  owned: number;

  rrp: number | null;
  rrpBasis: RrpBasis;
  /** rrp x owned, or null when there is no RRP. */
  rrpLine: number | null;

  paidPerSet: number | null;
  paidTotal: number | null;
  paidBasis: PaidBasis;

  releaseDate: string | null;
  retirementDate: string | null;
  status: SetStatus;

  currentValueNew: number | null;
  /** currentValueNew x owned, or null when there is no value. */
  valueLine: number | null;
  usedValue: number | null;
  valueBasis: ValueBasis;

  growthVsRrpPct: number | null;
  annualGrowthPct: number | null;

  /** valueLine - paidTotal. Null unless BOTH are known. Nothing else subtracted. */
  profitVsPaid: number | null;

  sourceUrl: string | null;
  /** Plain-language reasons for any null above. */
  notes: string[];
  resolutionError: string | null;
}

export interface LotTotals {
  setCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  totalCopies: number;

  totalRrp: number;
  rowsMissingRrp: number;
  freePromotionalRows: number;

  totalCurrentValue: number;
  rowsMissingValue: number;

  /** Sum of every per-row paid amount the client supplied. */
  totalPaidFromRows: number;
  rowsMissingPaid: number;
  /**
   * Paid amounts belonging to rows that have no current value. These are held
   * out of the profit comparison: charging them against a value of zero would
   * treat an unpriceable set as worthless and bias profit downwards.
   */
  paidExcludedNoValue: number;
  rowsPaidButUnvalued: number;
  /** A single lot price, when that is how the lot was bought. */
  lotPaidTotal: number | null;
  /** Whichever paid figure the profit below is actually based on. */
  paidBasisUsed: "PER_ROW" | "LOT_TOTAL" | "NONE";
  effectivePaidTotal: number | null;

  /**
   * totalCurrentValue (restricted to rows counted in effectivePaidTotal when
   * paid is per-row) minus effectivePaidTotal. Null when nothing was paid in.
   */
  totalProfit: number | null;
  /** Profit as a percentage of what was paid. Null when paid is 0 or unknown. */
  profitPct: number | null;
  /** Value of the rows the profit figure actually covers. */
  valueCoveredByPaid: number;
  /** How many rows the profit figure covers, out of how many. */
  profitRowsCovered: number;

  statusCounts: Record<SetStatus, number>;
  /** Share of total value sitting in retired sets, 0-100. Null if no value. */
  retiredValueSharePct: number | null;
  currency: string;
}

export interface LotInsight {
  title: string;
  headline: string;
  detail: string;
  tone: "positive" | "neutral" | "warning";
}

export interface LotAnalysis {
  rows: LotAnalysisRow[];
  totals: LotTotals;
  insights: LotInsight[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Row building                                                        */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Resolves which paid figure, if any, the client actually gave for a row. */
export function resolvePaid(row: LotInputRow, owned: number): {
  paidPerSet: number | null;
  paidTotal: number | null;
  basis: PaidBasis;
} {
  const hasTotal = typeof row.paidTotal === "number" && Number.isFinite(row.paidTotal);
  const hasPerSet = typeof row.paidPerSet === "number" && Number.isFinite(row.paidPerSet);

  if (hasTotal) {
    const total = row.paidTotal as number;
    if (total === 0) {
      return { paidPerSet: 0, paidTotal: 0, basis: "SUPPLIED_ZERO" };
    }
    return {
      paidPerSet: owned > 0 ? round2(total / owned) : null,
      paidTotal: round2(total),
      basis: "SUPPLIED_TOTAL",
    };
  }

  if (hasPerSet) {
    const per = row.paidPerSet as number;
    if (per === 0) {
      return { paidPerSet: 0, paidTotal: 0, basis: "SUPPLIED_ZERO" };
    }
    return { paidPerSet: round2(per), paidTotal: round2(per * owned), basis: "SUPPLIED_PER_SET" };
  }

  return { paidPerSet: null, paidTotal: null, basis: "NOT_SUPPLIED" };
}

export function buildRow(input: LotInputRow, facts: SetFacts, lotPricedAsWhole: boolean): LotAnalysisRow {
  const owned = input.owned && input.owned > 0 ? Math.floor(input.owned) : 1;
  const paid = resolvePaid(input, owned);
  const notes: string[] = [];

  const rrpLine = facts.rrp !== null ? round2(facts.rrp * owned) : null;
  const valueLine = facts.currentValueNew !== null ? round2(facts.currentValueNew * owned) : null;

  // Profit only when both sides are real. Never value-minus-nothing.
  let profitVsPaid: number | null = null;
  if (valueLine !== null && paid.paidTotal !== null) {
    profitVsPaid = round2(valueLine - paid.paidTotal);
  }

  if (facts.resolutionError) {
    notes.push(facts.resolutionError);
  }
  if (facts.rrpBasis === "FREE_PROMOTIONAL") {
    notes.push("Free promotional set (gift with purchase) — it has no retail price, so growth vs RRP does not apply");
  } else if (facts.rrp === null) {
    notes.push("No retail price found — excluded from the RRP total");
  }
  if (facts.currentValueNew === null) {
    notes.push("No current value found — excluded from the value total");
  } else if (facts.valueBasis === "RETAIL_PRICE") {
    notes.push("Still at retail, so the retail price is used as the current value");
  }
  if (paid.basis === "NOT_SUPPLIED") {
    notes.push(
      lotPricedAsWhole
        ? "Lot was bought for a single price, which is not split across sets — profit is shown at lot level only"
        : "No paid amount supplied — profit cannot be calculated for this line"
    );
  }

  return {
    input: input.input,
    setNumber: facts.setNumber,
    name: facts.name,
    theme: facts.theme,
    subtheme: facts.subtheme,
    year: facts.year,
    pieces: facts.pieces,
    owned,
    rrp: facts.rrp,
    rrpBasis: facts.rrpBasis,
    rrpLine,
    paidPerSet: paid.paidPerSet,
    paidTotal: paid.paidTotal,
    paidBasis: paid.basis,
    releaseDate: facts.releaseDate,
    retirementDate: facts.retirementDate,
    status: facts.status,
    currentValueNew: facts.currentValueNew,
    valueLine,
    usedValue: facts.usedValue,
    valueBasis: facts.valueBasis,
    growthVsRrpPct: facts.growthVsRrpPct,
    annualGrowthPct: facts.annualGrowthPct,
    profitVsPaid,
    sourceUrl: facts.sourceUrl,
    notes,
    resolutionError: facts.resolutionError,
  };
}

/* ------------------------------------------------------------------ */
/* Roll-up                                                             */
/* ------------------------------------------------------------------ */

export function computeTotals(
  rows: LotAnalysisRow[],
  lotPaidTotal: number | null,
  currency = "EUR"
): LotTotals {
  const statusCounts: Record<SetStatus, number> = {
    RETAIL: 0,
    RETIRING_SOON: 0,
    RETIRED: 0,
    UNKNOWN: 0,
  };

  let totalRrp = 0;
  let totalCurrentValue = 0;
  let totalPaidFromRows = 0;
  let rowsMissingRrp = 0;
  let rowsMissingValue = 0;
  let rowsMissingPaid = 0;
  let freePromotionalRows = 0;
  let totalCopies = 0;
  let resolvedCount = 0;
  let retiredValue = 0;

  // Profit must compare like with like: only rows carrying BOTH a paid amount
  // and a value take part, on both sides of the subtraction.
  let valueOfPaidRows = 0;
  let paidOfValuedRows = 0;
  let paidExcludedNoValue = 0;
  let rowsPaidButUnvalued = 0;
  let profitRowsCovered = 0;

  for (const r of rows) {
    totalCopies += r.owned;
    statusCounts[r.status] += 1;
    if (!r.resolutionError) resolvedCount += 1;
    if (r.rrpBasis === "FREE_PROMOTIONAL") freePromotionalRows += 1;

    if (r.rrpLine !== null) totalRrp += r.rrpLine;
    else rowsMissingRrp += 1;

    if (r.valueLine !== null) {
      totalCurrentValue += r.valueLine;
      if (r.status === "RETIRED") retiredValue += r.valueLine;
    } else {
      rowsMissingValue += 1;
    }

    if (r.paidTotal !== null) {
      totalPaidFromRows += r.paidTotal;
      if (r.valueLine !== null) {
        valueOfPaidRows += r.valueLine;
        paidOfValuedRows += r.paidTotal;
        profitRowsCovered += 1;
      } else {
        paidExcludedNoValue += r.paidTotal;
        rowsPaidButUnvalued += 1;
      }
    } else {
      rowsMissingPaid += 1;
    }
  }

  const hasRowPaid = rows.some((r) => r.paidTotal !== null && r.paidTotal > 0);
  const hasLotPaid = typeof lotPaidTotal === "number" && Number.isFinite(lotPaidTotal) && lotPaidTotal > 0;

  let paidBasisUsed: LotTotals["paidBasisUsed"] = "NONE";
  let effectivePaidTotal: number | null = null;
  let totalProfit: number | null = null;
  let valueCoveredByPaid = 0;
  let covered = 0;

  if (hasRowPaid) {
    // Per-row paid amounts win: they are the more specific figure.
    // Both sides are restricted to rows that have a value, so a set we could
    // not price does not drag its purchase cost into the comparison.
    paidBasisUsed = "PER_ROW";
    effectivePaidTotal = round2(paidOfValuedRows);
    valueCoveredByPaid = round2(valueOfPaidRows);
    covered = profitRowsCovered;
    totalProfit = round2(valueOfPaidRows - paidOfValuedRows);
  } else if (hasLotPaid) {
    // One price for the whole lot: compare against the whole lot's value.
    paidBasisUsed = "LOT_TOTAL";
    effectivePaidTotal = round2(lotPaidTotal as number);
    valueCoveredByPaid = round2(totalCurrentValue);
    covered = rows.length - rowsMissingValue;
    totalProfit = round2(totalCurrentValue - (lotPaidTotal as number));
  }

  const profitPct =
    totalProfit !== null && effectivePaidTotal !== null && effectivePaidTotal > 0
      ? round2((totalProfit / effectivePaidTotal) * 100)
      : null;

  return {
    setCount: rows.length,
    resolvedCount,
    unresolvedCount: rows.length - resolvedCount,
    totalCopies,
    totalRrp: round2(totalRrp),
    rowsMissingRrp,
    freePromotionalRows,
    totalCurrentValue: round2(totalCurrentValue),
    rowsMissingValue,
    totalPaidFromRows: round2(totalPaidFromRows),
    rowsMissingPaid,
    paidExcludedNoValue: round2(paidExcludedNoValue),
    rowsPaidButUnvalued,
    lotPaidTotal: hasLotPaid ? round2(lotPaidTotal as number) : null,
    paidBasisUsed,
    effectivePaidTotal,
    totalProfit,
    profitPct,
    valueCoveredByPaid,
    profitRowsCovered: covered,
    statusCounts,
    retiredValueSharePct:
      totalCurrentValue > 0 ? round2((retiredValue / totalCurrentValue) * 100) : null,
    currency,
  };
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

const money = (n: number, cur: string) =>
  `${cur === "EUR" ? "€" : cur + " "}${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function buildInsights(rows: LotAnalysisRow[], t: LotTotals): LotInsight[] {
  const cur = t.currency;
  const insights: LotInsight[] = [];

  /* 1. The money question */
  if (t.totalProfit !== null && t.effectivePaidTotal !== null) {
    const basis =
      t.paidBasisUsed === "LOT_TOTAL"
        ? `against the single lot price of ${money(t.effectivePaidTotal, cur)}`
        : `against ${money(t.effectivePaidTotal, cur)} paid across ${t.profitRowsCovered} of ${t.setCount} lines`;

    const heldOut =
      t.rowsPaidButUnvalued > 0
        ? ` ${money(t.paidExcludedNoValue, cur)} paid on ${t.rowsPaidButUnvalued} unpriced line${
            t.rowsPaidButUnvalued === 1 ? "" : "s"
          } is held out of both sides.`
        : "";

    insights.push({
      title: "Value vs what was paid",
      headline: `${money(t.totalProfit, cur)}${t.profitPct !== null ? ` (${t.profitPct > 0 ? "+" : ""}${t.profitPct}%)` : ""}`,
      detail: `${money(t.valueCoveredByPaid, cur)} of current value ${basis}. Nothing is deducted for shipping, packaging or fees.${heldOut}`,
      tone: t.totalProfit > 0 ? "positive" : "warning",
    });
  } else {
    insights.push({
      title: "Current value",
      headline: money(t.totalCurrentValue, cur),
      detail: `${t.totalCopies} copies across ${t.setCount} sets. Add what you paid to see profit.`,
      tone: "neutral",
    });
  }

  /* 2. Value against RRP */
  if (t.totalRrp > 0) {
    const delta = round2(t.totalCurrentValue - t.totalRrp);
    const pct = round2((delta / t.totalRrp) * 100);
    insights.push({
      title: "Against retail price",
      headline: `${delta >= 0 ? "+" : ""}${money(delta, cur)} (${pct >= 0 ? "+" : ""}${pct}%)`,
      detail: `Current value ${money(t.totalCurrentValue, cur)} vs ${money(t.totalRrp, cur)} RRP${
        t.rowsMissingRrp > 0
          ? `. ${t.rowsMissingRrp} line${t.rowsMissingRrp === 1 ? "" : "s"} carry no RRP${
              t.freePromotionalRows > 0 ? ` (${t.freePromotionalRows} free promotional)` : ""
            } and sit outside this comparison`
          : ""
      }.`,
      tone: delta >= 0 ? "positive" : "warning",
    });
  }

  /* 3. Lifecycle: where the value sits */
  const retired = t.statusCounts.RETIRED;
  const retiring = t.statusCounts.RETIRING_SOON;
  const retail = t.statusCounts.RETAIL;
  insights.push({
    title: "Retirement status",
    headline: `${retired} retired · ${retiring} retiring soon · ${retail} at retail`,
    detail:
      t.retiredValueSharePct !== null
        ? `${t.retiredValueSharePct}% of current value sits in retired sets, where prices are set by the secondary market rather than by LEGO.`
        : "No current values available, so the value split cannot be shown.",
    tone: "neutral",
  });

  /* 4. Data coverage — gaps stated plainly, not hidden */
  const gaps: string[] = [];
  if (t.unresolvedCount > 0) gaps.push(`${t.unresolvedCount} not found`);
  if (t.rowsMissingValue > 0) gaps.push(`${t.rowsMissingValue} without a current value`);
  if (t.rowsMissingRrp > 0) gaps.push(`${t.rowsMissingRrp} without an RRP`);
  if (t.rowsMissingPaid > 0 && t.paidBasisUsed === "PER_ROW") {
    gaps.push(`${t.rowsMissingPaid} without a paid amount`);
  }

  const topGrowth = rows
    .filter((r) => r.growthVsRrpPct !== null)
    .sort((a, b) => (b.growthVsRrpPct ?? 0) - (a.growthVsRrpPct ?? 0))[0];

  insights.push({
    title: gaps.length > 0 ? "Data gaps" : "Data coverage",
    headline:
      gaps.length > 0
        ? gaps.join(" · ")
        : `All ${t.setCount} sets priced`,
    detail:
      gaps.length > 0
        ? "Missing figures are left out of the totals rather than estimated, so the totals are understated rather than guessed."
        : topGrowth
          ? `Strongest growth vs RRP: ${topGrowth.setNumber} ${topGrowth.name ?? ""} at +${topGrowth.growthVsRrpPct}%.`
          : "Every line carries a current value.",
    tone: gaps.length > 0 ? "warning" : "positive",
  });

  return insights;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function analyseLot(
  inputs: LotInputRow[],
  factsByInput: Map<string, SetFacts>,
  options: { lotPaidTotal?: number | null; currency?: string } = {}
): LotAnalysis {
  const currency = options.currency ?? "EUR";
  const lotPaidTotal =
    typeof options.lotPaidTotal === "number" && Number.isFinite(options.lotPaidTotal)
      ? options.lotPaidTotal
      : null;

  const anyRowPaid = inputs.some(
    (r) =>
      (typeof r.paidTotal === "number" && Number.isFinite(r.paidTotal)) ||
      (typeof r.paidPerSet === "number" && Number.isFinite(r.paidPerSet))
  );
  const lotPricedAsWhole = !anyRowPaid && lotPaidTotal !== null;

  const rows = inputs.map((input) => {
    const facts = factsByInput.get(input.input);
    if (!facts) {
      return buildRow(
        input,
        {
          ...({} as SetFacts),
          setNumber: input.input,
          input: input.input,
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
          resolutionError: "Not looked up",
        },
        lotPricedAsWhole
      );
    }
    return buildRow(input, facts, lotPricedAsWhole);
  });

  const totals = computeTotals(rows, lotPaidTotal, currency);
  return {
    rows,
    totals,
    insights: buildInsights(rows, totals),
    generatedAt: new Date().toISOString(),
  };
}
