import {
  fetchSetFacts,
  resolveSetPath,
  extractSection,
  extractRows,
  parseMoney,
  parsePct,
  parseCount,
  baseSetNumber,
  Fetcher,
} from "@/services/pricing/setFacts/brickEconomyClient";
import {
  PAGE_10255,
  PAGE_40601,
  PAGE_AT_RETAIL,
  PAGE_USD,
  SEARCH_10255,
  SEARCH_WRONG_SET,
} from "./fixtures/brickEconomyPages";

/** Fake fetcher: maps a URL substring to fixture HTML. Never touches network. */
function fakeFetcher(routes: Array<[RegExp, string]>, calls: string[] = []): Fetcher {
  return async (url: string) => {
    calls.push(url);
    for (const [re, body] of routes) {
      if (re.test(url)) return { ok: true, status: 200, text: body };
    }
    return { ok: false, status: 404, text: "" };
  };
}

const routes10255: Array<[RegExp, string]> = [
  [/\/search\?query=10255/, SEARCH_10255],
  [/\/set\/10255-1\//, PAGE_10255],
];

describe("BrickEconomy parsing primitives", () => {
  it("strips the base set number from assorted inputs", () => {
    expect(baseSetNumber("10255")).toBe("10255");
    expect(baseSetNumber("10255-1")).toBe("10255");
    expect(baseSetNumber(" LEGO 10255 ")).toBe("10255");
    expect(baseSetNumber("set:10255-1")).toBe("10255");
  });

  it("slices a section without being truncated by side-box-head/body", () => {
    // Regression: /\bside-box\b/ also matches side-box-head and side-box-body,
    // which cut the slice to a few hundred chars and yielded zero rows.
    const section = extractSection(PAGE_10255, "Set Pricing");
    expect(section).not.toBeNull();
    expect(section!.length).toBeGreaterThan(500);
    expect(extractRows(section!).length).toBeGreaterThanOrEqual(10);
  });

  it("reads a label cell wrapped in a span and a value cell with nested text-muted", () => {
    const rows = extractRows(extractSection(PAGE_10255, "Set Details")!);
    const pieces = rows.find((r) => r.label === "Pieces");
    expect(pieces).toBeDefined();
    expect(parseCount(pieces!.value)).toBe(4002);

    const pricing = extractRows(extractSection(PAGE_10255, "Set Pricing")!);
    const oneYear = pricing.find((r) => r.label === "1-year growth");
    expect(oneYear).toBeDefined();
    expect(parsePct(oneYear!.value)).toBe(5.48);
  });

  it("parses money, percentages and counts, and never guesses", () => {
    expect(parseMoney("€299.99").amount).toBe(299.99);
    expect(parseMoney("€1,320.59").amount).toBe(1320.59);
    // Regression: a four-figure price with no thousands separator used to be
    // truncated to its first three digits (€1320.59 -> 132).
    expect(parseMoney("€1320.59").amount).toBe(1320.59);
    expect(parseMoney("€849.99").amount).toBe(849.99);
    expect(parseCount("2017")).toBe(2017);
    expect(parseCount("4,002 (PPP €0.07)")).toBe(4002);
    expect(parseCount("11,695")).toBe(11695);
    expect(parseMoney("Free promotional").freePromotional).toBe(true);
    expect(parseMoney("Free promotional").amount).toBeNull();
    expect(parseMoney("$299.99").currency).toBe("USD");
    expect(parseMoney(null).amount).toBeNull();
    expect(parseMoney("—").amount).toBeNull();

    expect(parsePct("+6.87%")).toBe(6.87);
    expect(parsePct("-3.77%")).toBe(-3.77);
    expect(parsePct("+25.54% (Since retirement)")).toBe(25.54);
    expect(parsePct("no percentage here")).toBeNull();
  });
});

describe("resolveSetPath", () => {
  it("returns the canonical slug path for a matching set", async () => {
    const path = await resolveSetPath("10255", fakeFetcher(routes10255));
    expect(path).toBe("/set/10255-1/lego-assembly-square");
  });

  it("refuses a first result that is a different set rather than guessing", async () => {
    const path = await resolveSetPath(
      "10255",
      fakeFetcher([[/\/search/, SEARCH_WRONG_SET]])
    );
    expect(path).toBeNull();
  });
});

describe("fetchSetFacts — retired set with a real RRP", () => {
  it("reads every KPI from the correct section", async () => {
    const f = await fetchSetFacts("10255", fakeFetcher(routes10255));

    expect(f.resolutionError).toBeNull();
    expect(f.setNumber).toBe("10255-1");
    expect(f.name).toBe("Assembly Square");
    expect(f.theme).toBe("Icons");
    expect(f.subtheme).toBe("Modular Buildings");
    expect(f.year).toBe(2017);
    expect(f.pieces).toBe(4002);

    expect(f.rrp).toBe(299.99);
    expect(f.rrpBasis).toBe("RETAIL_PRICE");
    expect(f.releaseDate).toBe("January 2, 2017");
    expect(f.retirementDate).toBe("February 2024");
    expect(f.status).toBe("RETIRED");

    expect(f.currentValueNew).toBe(320.59);
    expect(f.usedValue).toBe(197.25);
    expect(f.valueBasis).toBe("MARKET_VALUE_NEW");

    expect(f.growthVsRrpPct).toBe(6.87);
    expect(f.twelveMonthOutlookPct).toBe(5.48);
  });

  it("takes annual growth from Set Pricing, NOT from Subtheme Analysis", async () => {
    const f = await fetchSetFacts("10255", fakeFetcher(routes10255));
    // The page carries +7.20% for this set and +10.66% for the subtheme.
    expect(f.annualGrowthPct).toBe(7.2);
    expect(f.annualGrowthPct).not.toBe(10.66);
  });

  it("distinguishes the first Value (new) from the second (used)", async () => {
    const f = await fetchSetFacts("10255", fakeFetcher(routes10255));
    expect(f.currentValueNew).toBe(320.59);
    expect(f.usedValue).toBe(197.25);
    expect(f.currentValueNew).not.toBe(f.usedValue);
  });
});

describe("fetchSetFacts — gift-with-purchase set", () => {
  const routes: Array<[RegExp, string]> = [
    [/\/search\?query=40601/, '<a href="/set/40601-1/lego-majistos-magical-workshop">x</a>'],
    [/\/set\/40601-1\//, PAGE_40601],
  ];

  it("records a free set as null RRP with a FREE_PROMOTIONAL basis, never 0", async () => {
    const f = await fetchSetFacts("40601", fakeFetcher(routes));
    expect(f.rrp).toBeNull();
    expect(f.rrpBasis).toBe("FREE_PROMOTIONAL");
    expect(f.rrp).not.toBe(0);
  });

  it("leaves growth vs RRP null when the page carries no Growth row", async () => {
    const f = await fetchSetFacts("40601", fakeFetcher(routes));
    expect(f.growthVsRrpPct).toBeNull();
    expect(f.growthVsRrpPct).not.toBe(0);
    // The set still has a real market value.
    expect(f.currentValueNew).toBe(34.07);
    expect(f.usedValue).toBe(23.27);
    expect(f.annualGrowthPct).toBe(12.45);
  });
});

describe("fetchSetFacts — still at retail", () => {
  const routes: Array<[RegExp, string]> = [
    [/\/search\?query=10330/, '<a href="/set/10330-1/lego-mclaren">x</a>'],
    [/\/set\/10330-1\//, PAGE_AT_RETAIL],
  ];

  it("uses the retail price as current value and says so", async () => {
    const f = await fetchSetFacts("10330", fakeFetcher(routes));
    expect(f.status).toBe("RETAIL");
    expect(f.rrp).toBe(79.99);
    expect(f.currentValueNew).toBe(79.99);
    expect(f.valueBasis).toBe("RETAIL_PRICE");
    expect(f.retirementDate).toBeNull(); // "-" is not a date
  });
});

describe("fetchSetFacts — failure modes are explicit, never silent zeros", () => {
  it("refuses a page priced in USD instead of mixing currencies", async () => {
    const routes: Array<[RegExp, string]> = [
      [/\/search/, '<a href="/set/10255-1/lego-assembly-square">x</a>'],
      [/\/set\/10255-1\//, PAGE_USD],
    ];
    const f = await fetchSetFacts("10255", fakeFetcher(routes));
    expect(f.resolutionError).toMatch(/USD/);
    expect(f.currentValueNew).toBeNull();
  });

  it("reports a set it cannot resolve", async () => {
    const f = await fetchSetFacts("99999", fakeFetcher([]));
    expect(f.resolutionError).toBeTruthy();
    expect(f.rrp).toBeNull();
    expect(f.currentValueNew).toBeNull();
  });
});
