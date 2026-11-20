import fs from "fs";
import path from "path";
import {
  analyseLot,
  computeTotals,
  resolvePaid,
  buildRow,
  LotInputRow,
} from "@/services/pricing/lotAnalysisService";
import { SetFacts, emptyFacts } from "@/services/pricing/setFacts/types";
import { parseFreeText, parseSheetRows, parseLooseNumber } from "@/services/pricing/bulkInputParser";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function facts(overrides: Partial<SetFacts> & { setNumber: string }): SetFacts {
  return { ...emptyFacts(overrides.setNumber, overrides.setNumber), ...overrides };
}

function factsMap(list: SetFacts[]): Map<string, SetFacts> {
  const m = new Map<string, SetFacts>();
  for (const f of list) m.set(f.input, f);
  return m;
}

const retiredSet = (num: string, rrp: number, value: number) =>
  facts({
    setNumber: num,
    input: num,
    name: `Set ${num}`,
    theme: "Icons",
    rrp,
    rrpBasis: "RETAIL_PRICE",
    status: "RETIRED",
    retirementDate: "February 2024",
    currentValueNew: value,
    valueBasis: "MARKET_VALUE_NEW",
    growthVsRrpPct: Math.round(((value - rrp) / rrp) * 10000) / 100,
  });

/* ------------------------------------------------------------------ */
/* THE CORE INVARIANT: profit is value minus paid, nothing else        */
/* ------------------------------------------------------------------ */

describe("profit is value minus paid, with nothing else subtracted", () => {
  it("never deducts shipping, packaging, handling or fees on any row", () => {
    const inputs: LotInputRow[] = [
      { input: "10255", owned: 1, paidTotal: 200 },
      { input: "21344", owned: 5, paidTotal: 100 }, // 5 copies: a per-copy charge would show here
      { input: "40601", owned: 3, paidTotal: 30 },
    ];
    const analysis = analyseLot(
      inputs,
      factsMap([
        retiredSet("10255", 299.99, 320.59),
        retiredSet("21344", 299.99, 422),
        retiredSet("40601", 20, 34.07),
      ])
    );

    for (const r of analysis.rows) {
      expect(r.valueLine).not.toBeNull();
      expect(r.paidTotal).not.toBeNull();
      // Exact equality: any per-copy cost would break this on the 5-copy row.
      expect(r.profitVsPaid).toBeCloseTo((r.valueLine as number) - (r.paidTotal as number), 10);
    }

    const t = analysis.totals;
    expect(t.totalProfit).toBeCloseTo(t.valueCoveredByPaid - (t.effectivePaidTotal as number), 10);
  });

  it("reproduces the multi-copy case that previously showed a false loss", () => {
    // 5 copies, €39.55 of value, €16.58 paid. A €12.70 per-copy handling
    // charge turned this genuinely profitable line into -€43.75.
    const inputs: LotInputRow[] = [{ input: "40600", owned: 5, paidTotal: 16.58 }];
    const analysis = analyseLot(
      inputs,
      factsMap([
        facts({
          setNumber: "40600",
          input: "40600",
          currentValueNew: 7.91,
          valueBasis: "MARKET_VALUE_NEW",
          status: "RETIRED",
        }),
      ])
    );

    const row = analysis.rows[0];
    expect(row.valueLine).toBeCloseTo(39.55, 2);
    expect(row.profitVsPaid).toBeCloseTo(22.97, 2);
    expect(row.profitVsPaid).toBeGreaterThan(0);
  });

  it("has no cost, fee, shipping or handling term in the source at all", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/pricing/lotAnalysisService.ts"),
      "utf-8"
    );
    // Scan executable code only. The rules are documented in comments and the
    // UI disclaimer names these terms in prose ("nothing is deducted for
    // shipping..."), so comments and string literals are stripped first.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/`[\s\S]*?`/g, '""')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    for (const banned of [
      "shipping",
      "packaging",
      "handling",
      "feeService",
      "calculateChannelProceeds",
      "breakeven",
      "haircut",
    ]) {
      expect(code.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

/* ------------------------------------------------------------------ */
/* A single lot price is never split across sets                       */
/* ------------------------------------------------------------------ */

describe("a single lot price stays at lot level", () => {
  const inputs: LotInputRow[] = [
    { input: "10255", owned: 1 },
    { input: "21344", owned: 2 },
  ];
  const map = factsMap([retiredSet("10255", 299.99, 320.59), retiredSet("21344", 299.99, 422)]);

  it("does not allocate the lot price to any row", () => {
    const analysis = analyseLot(inputs, map, { lotPaidTotal: 300 });
    for (const r of analysis.rows) {
      expect(r.paidTotal).toBeNull();
      expect(r.paidBasis).toBe("NOT_SUPPLIED");
      expect(r.profitVsPaid).toBeNull();
      expect(r.notes.join(" ")).toMatch(/not split across sets/i);
    }
  });

  it("compares the whole lot's value against the single price", () => {
    const analysis = analyseLot(inputs, map, { lotPaidTotal: 300 });
    const t = analysis.totals;
    const expectedValue = 320.59 + 422 * 2;

    expect(t.paidBasisUsed).toBe("LOT_TOTAL");
    expect(t.totalCurrentValue).toBeCloseTo(expectedValue, 2);
    expect(t.effectivePaidTotal).toBe(300);
    expect(t.totalProfit).toBeCloseTo(expectedValue - 300, 2);
    expect(t.profitPct).toBeCloseTo(((expectedValue - 300) / 300) * 100, 1);
  });

  it("prefers per-row paid amounts over a lot price when both are given", () => {
    const withRowPaid: LotInputRow[] = [
      { input: "10255", owned: 1, paidTotal: 150 },
      { input: "21344", owned: 2, paidTotal: 400 },
    ];
    const t = analyseLot(withRowPaid, map, { lotPaidTotal: 300 }).totals;
    expect(t.paidBasisUsed).toBe("PER_ROW");
    expect(t.effectivePaidTotal).toBe(550);
  });
});

/* ------------------------------------------------------------------ */
/* Unknown is not zero                                                 */
/* ------------------------------------------------------------------ */

describe("unknown is never reported as zero", () => {
  it("keeps a free promotional set's RRP and growth null, not 0", () => {
    const row = buildRow(
      { input: "40601", owned: 2 },
      facts({
        setNumber: "40601",
        input: "40601",
        rrp: null,
        rrpBasis: "FREE_PROMOTIONAL",
        currentValueNew: 34.07,
        valueBasis: "MARKET_VALUE_NEW",
        growthVsRrpPct: null,
      }),
      false
    );

    expect(row.rrp).toBeNull();
    expect(row.rrpLine).toBeNull();
    expect(row.growthVsRrpPct).toBeNull();
    expect(row.rrp).not.toBe(0);
    expect(row.valueLine).toBeCloseTo(68.14, 2);
    expect(row.notes.join(" ")).toMatch(/gift with purchase/i);
  });

  it("leaves profit null when no paid amount was supplied, rather than claiming full value", () => {
    const row = buildRow(
      { input: "10255", owned: 1 },
      retiredSet("10255", 299.99, 320.59),
      false
    );
    expect(row.paidTotal).toBeNull();
    expect(row.profitVsPaid).toBeNull();
    expect(row.profitVsPaid).not.toBe(320.59);
  });

  it("distinguishes a supplied zero from a missing figure", () => {
    expect(resolvePaid({ input: "x", paidTotal: 0 }, 1).basis).toBe("SUPPLIED_ZERO");
    expect(resolvePaid({ input: "x" }, 1).basis).toBe("NOT_SUPPLIED");
    expect(resolvePaid({ input: "x" }, 1).paidTotal).toBeNull();

    // An explicitly free line is pure upside, and profit IS the value.
    const row = buildRow(
      { input: "40601", owned: 1, paidTotal: 0 },
      facts({ setNumber: "40601", input: "40601", currentValueNew: 34.07, valueBasis: "MARKET_VALUE_NEW" }),
      false
    );
    expect(row.profitVsPaid).toBeCloseTo(34.07, 2);
  });

  it("excludes missing values from totals and counts the exclusions", () => {
    const inputs: LotInputRow[] = [
      { input: "10255", owned: 1, paidTotal: 100 },
      { input: "99999", owned: 1, paidTotal: 50 },
    ];
    const unknown = facts({ setNumber: "99999", input: "99999", resolutionError: "Not found on BrickEconomy" });
    const t = analyseLot(inputs, factsMap([retiredSet("10255", 299.99, 320.59), unknown])).totals;

    expect(t.totalCurrentValue).toBeCloseTo(320.59, 2);
    expect(t.rowsMissingValue).toBe(1);
    expect(t.rowsMissingRrp).toBe(1);
    expect(t.unresolvedCount).toBe(1);
    // Profit only covers the row that has both sides. The €50 paid for the
    // unpriceable set is held out of BOTH sides rather than being charged
    // against a value of zero, which would bias profit downwards.
    expect(t.profitRowsCovered).toBe(1);
    expect(t.totalPaidFromRows).toBeCloseTo(150, 2);
    expect(t.effectivePaidTotal).toBeCloseTo(100, 2);
    expect(t.paidExcludedNoValue).toBeCloseTo(50, 2);
    expect(t.rowsPaidButUnvalued).toBe(1);
    expect(t.totalProfit).toBeCloseTo(320.59 - 100, 2);
  });

  it("never produces a ratio against a zero or unknown paid total", () => {
    const noPaid = analyseLot([{ input: "10255", owned: 1 }], factsMap([retiredSet("10255", 299.99, 320.59)])).totals;
    expect(noPaid.profitPct).toBeNull();
    expect(noPaid.totalProfit).toBeNull();
    expect(noPaid.paidBasisUsed).toBe("NONE");

    const zeroPaid = computeTotals(
      [buildRow({ input: "40601", owned: 1, paidTotal: 0 }, facts({ setNumber: "40601", input: "40601", currentValueNew: 10, valueBasis: "MARKET_VALUE_NEW" }), false)],
      null
    );
    expect(zeroPaid.profitPct).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Totals tie                                                          */
/* ------------------------------------------------------------------ */

describe("totals tie to the rows", () => {
  it("sums copies, RRP, value and paid exactly", () => {
    const inputs: LotInputRow[] = [
      { input: "10255", owned: 2, paidTotal: 400 },
      { input: "21344", owned: 3, paidTotal: 600 },
      { input: "40601", owned: 1, paidTotal: 10 },
    ];
    const analysis = analyseLot(
      inputs,
      factsMap([
        retiredSet("10255", 299.99, 320.59),
        retiredSet("21344", 299.99, 422),
        facts({ setNumber: "40601", input: "40601", rrpBasis: "FREE_PROMOTIONAL", currentValueNew: 34.07, valueBasis: "MARKET_VALUE_NEW" }),
      ])
    );
    const t = analysis.totals;

    expect(t.totalCopies).toBe(6);
    expect(t.totalRrp).toBeCloseTo(299.99 * 2 + 299.99 * 3, 2);
    expect(t.totalCurrentValue).toBeCloseTo(320.59 * 2 + 422 * 3 + 34.07, 2);
    expect(t.totalPaidFromRows).toBeCloseTo(1010, 2);
    expect(t.freePromotionalRows).toBe(1);

    const rowSum = analysis.rows.reduce((s, r) => s + (r.valueLine ?? 0), 0);
    expect(t.totalCurrentValue).toBeCloseTo(rowSum, 2);
    expect(t.totalProfit).toBeCloseTo(rowSum - 1010, 2);
  });

  it("counts status and the share of value sitting in retired sets", () => {
    const inputs: LotInputRow[] = [{ input: "10255", owned: 1 }, { input: "10330", owned: 1 }];
    const t = analyseLot(
      inputs,
      factsMap([
        retiredSet("10255", 299.99, 300),
        facts({ setNumber: "10330", input: "10330", status: "RETAIL", rrp: 100, rrpBasis: "RETAIL_PRICE", currentValueNew: 100, valueBasis: "RETAIL_PRICE" }),
      ])
    ).totals;

    expect(t.statusCounts.RETIRED).toBe(1);
    expect(t.statusCounts.RETAIL).toBe(1);
    expect(t.retiredValueSharePct).toBeCloseTo(75, 1);
  });
});

/* ------------------------------------------------------------------ */
/* Input parsing                                                       */
/* ------------------------------------------------------------------ */

describe("free-text parsing", () => {
  it("reads plain numbers, suffixes, multipliers and structured lines", () => {
    const { rows } = parseFreeText(
      ["10255", "40601-1", "75192 x3", "21344, 2, 150.00", "LEGO 10497"].join("\n")
    );
    expect(rows.map((r) => r.input)).toEqual(["10255", "40601", "75192", "21344", "10497"]);
    expect(rows[2].owned).toBe(3);
    expect(rows[3].owned).toBe(2);
    expect(rows[3].paidTotal).toBe(150);
    expect(rows[0].paidTotal).toBeNull();
  });

  it("reads a list pasted on one line and ignores headings", () => {
    const { rows } = parseFreeText("New\n40917 10343 40899 40761\nUsed:\n75352 75325");
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.input)).toContain("40917");
    expect(rows.map((r) => r.input)).toContain("75325");
  });

  it("reports lines it cannot read instead of dropping them silently", () => {
    const { rows, skipped } = parseFreeText("10255\nsome random note\n");
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].line).toBe("some random note");
  });
});

describe("spreadsheet parsing", () => {
  it("detects English headers including quantity and paid", () => {
    const { rows, columnsUsed } = parseSheetRows([
      { "Set Number": "10255-1", Owned: 2, "Paid Total": "400,00" },
      { "Set Number": "21344", Owned: 1, "Paid Total": "250.50" },
    ]);
    expect(columnsUsed?.setNumber).toBe("Set Number");
    expect(columnsUsed?.owned).toBe("Owned");
    expect(rows[0]).toMatchObject({ input: "10255", owned: 2, paidTotal: 400 });
    expect(rows[1].paidTotal).toBe(250.5);
  });

  it("detects Dutch headers, as on the client's own sheets", () => {
    const { rows, columnsUsed } = parseSheetRows([
      { Artikelnummer: "10255", Aantal: 3, "Totaal betaald": "1.234,56" },
    ]);
    expect(columnsUsed?.setNumber).toBe("Artikelnummer");
    expect(columnsUsed?.owned).toBe("Aantal");
    expect(rows[0].owned).toBe(3);
    expect(rows[0].paidTotal).toBeCloseTo(1234.56, 2);
  });

  it("falls back to whichever column actually holds set numbers", () => {
    const { rows, columnsUsed } = parseSheetRows([
      { col_a: "widget", col_b: "10255" },
      { col_a: "widget", col_b: "21344" },
    ]);
    expect(columnsUsed?.setNumber).toBe("col_b");
    expect(rows).toHaveLength(2);
  });

  it("refuses to guess when no column holds set numbers", () => {
    const { rows, skipped } = parseSheetRows([{ name: "a", note: "b" }]);
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/could not find a column/i);
  });

  it("assumes one copy when there is no quantity column, and no paid amount", () => {
    const { rows } = parseSheetRows([{ Number: "10255" }]);
    expect(rows[0].owned).toBe(1);
    expect(rows[0].paidTotal).toBeNull();
    expect(rows[0].paidPerSet).toBeNull();
  });
});

describe("loose number parsing", () => {
  it("handles European and English conventions", () => {
    expect(parseLooseNumber("1.234,56")).toBeCloseTo(1234.56, 2);
    expect(parseLooseNumber("1,234.56")).toBeCloseTo(1234.56, 2);
    expect(parseLooseNumber("400,00")).toBeCloseTo(400, 2);
    expect(parseLooseNumber("1,234")).toBeCloseTo(1234, 2);
    expect(parseLooseNumber("€ 299.99")).toBeCloseTo(299.99, 2);
    expect(parseLooseNumber(250.5)).toBeCloseTo(250.5, 2);
    expect(parseLooseNumber("")).toBeNull();
    expect(parseLooseNumber(null)).toBeNull();
  });
});
