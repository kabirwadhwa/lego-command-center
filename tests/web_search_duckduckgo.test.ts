import {
  DuckDuckGoHtmlDriver,
  createDefaultDrivers,
  selectActiveDriver,
  stripSearchHtml,
} from "@/services/pricing/providers/searchDrivers";
import {
  isValuationHost,
  isEurObservation,
  median,
} from "@/services/pricing/setFacts/setFactsService";

/**
 * Real DuckDuckGo HTML result markup, captured from the live endpoint on
 * 20 Nov 2026. Every href is a /l/?uddg= redirect, which is the detail a
 * parser has to get right or the real host is lost.
 */
const ddgResult = (encodedUrl: string, title: string, snippet: string) =>
  '<div class="result results_links results_links_deep web-result ">' +
  '<div class="links_main links_deep result__body"> <!-- This is the visible part -->' +
  `<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodedUrl}&amp;rut=9ee2b9cf">${title}</a></h2>` +
  '<div class="result__extras"><div class="result__extras__url">' +
  `<a class="result__url" href="//duckduckgo.com/l/?uddg=${encodedUrl}">display.url</a>` +
  "</div></div>" +
  `<a class="result__snippet" href="//duckduckgo.com/l/?uddg=${encodedUrl}&amp;rut=9ee2b9cf">${snippet}</a>` +
  "</div></div>";

const DDG_PAGE =
  "<html><body>" +
  ddgResult(
    "https%3A%2F%2Fwww.brickeconomy.com%2Fset%2F10255%2D1%2Flego%2Dassembly%2Dsquare",
    "LEGO 10255 Assembly Square | BrickEconomy",
    "LEGO set 10255 Assembly Square, what is it worth? <b>LEGO 10255</b> Assembly Square is a Icons set valued at &euro;320.59"
  ) +
  ddgResult(
    "https%3A%2F%2Fwww.ebay.nl%2Fitm%2F123456789",
    "LEGO 10255 Assembly Square NEW SEALED - sold",
    "Sold for &euro;340,00 on 12 Nov 2026"
  ) +
  ddgResult(
    "https%3A%2F%2Fwww.soldbrick.com%2Flego%2D10255",
    "LEGO 10255 Value - Real eBay Sold Prices",
    "sealed median $375, split by Sealed / Used"
  ) +
  "</body></html>";

function mockFetchOnce(body: string, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
  }) as unknown as typeof fetch;
}

describe("DuckDuckGo driver needs no API key", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("is always configured, so web search works with no env vars set", () => {
    expect(new DuckDuckGoHtmlDriver().isConfigured()).toBe(true);
  });

  it("is selected by WebSearchProvider when no keyed driver is configured", () => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_ENGINE_ID;
    delete process.env.GOOGLE_CSE_ID;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;

    const active = selectActiveDriver(createDefaultDrivers());
    expect(active).not.toBeNull();
    expect(active?.name).toMatch(/DuckDuckGo/);
  });

  it("prefers a keyed driver when one is configured", () => {
    process.env.SERPAPI_API_KEY = "test-key";
    expect(selectActiveDriver(createDefaultDrivers())?.name).toBe("SerpAPI");
  });

  it("decodes the uddg redirect to the real destination URL", () => {
    expect(
      DuckDuckGoHtmlDriver.resolveHref(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.ebay.nl%2Fitm%2F123456789&rut=abc"
      )
    ).toBe("https://www.ebay.nl/itm/123456789");

    // A plain protocol-relative or absolute href still resolves.
    expect(DuckDuckGoHtmlDriver.resolveHref("//example.com/x")).toBe("https://example.com/x");
    expect(DuckDuckGoHtmlDriver.resolveHref("https://example.com/y")).toBe("https://example.com/y");
    expect(DuckDuckGoHtmlDriver.resolveHref("")).toBeNull();
  });

  it("parses title, snippet and real host out of live result markup", async () => {
    mockFetchOnce(DDG_PAGE);
    const items = await new DuckDuckGoHtmlDriver().search('"LEGO 10255" sold');

    expect(items).toHaveLength(3);

    expect(items[0].link).toBe("https://www.brickeconomy.com/set/10255-1/lego-assembly-square");
    expect(items[0].title).toBe("LEGO 10255 Assembly Square | BrickEconomy");
    // Entities decoded, <b> tags stripped.
    expect(items[0].snippet).toContain("€320.59");
    expect(items[0].snippet).not.toContain("<b>");

    expect(items[1].link).toBe("https://www.ebay.nl/itm/123456789");
    expect(items[1].snippet).toContain("€340,00");

    // Crucially, no result keeps duckduckgo.com as its host.
    for (const item of items) {
      expect(item.link).not.toContain("duckduckgo.com");
    }
  });

  it("raises a clear error on a non-200 response", async () => {
    mockFetchOnce("", false, 503);
    await expect(new DuckDuckGoHtmlDriver().search("x")).rejects.toThrow(/503/);
  });

  it("returns nothing rather than throwing on an unrecognised page", async () => {
    mockFetchOnce("<html><body><p>no results</p></body></html>");
    await expect(new DuckDuckGoHtmlDriver().search("x")).resolves.toEqual([]);
  });
});

describe("stripSearchHtml", () => {
  it("decodes entities and drops a dangling tag", () => {
    expect(stripSearchHtml("Sold for &euro;340,00 <b>new</b>")).toBe("Sold for €340,00 new");
    expect(stripSearchHtml("value &amp; growth <div")).toBe("value & growth");
  });
});

describe("only real marketplace evidence in EUR may set a value", () => {
  it("accepts marketplace hosts", () => {
    for (const h of [
      "https://www.ebay.nl/itm/1",
      "EBAY.NL",
      "https://www.bricklink.com/v2/catalog/x",
      "https://www.catawiki.com/l/123",
      "https://www.marktplaats.nl/a/1",
      "https://www.2dehands.be/v/1",
      "https://www.bol.com/nl/p/x",
    ]) {
      expect(isValuationHost(h)).toBe(true);
    }
  });

  it("rejects valuation blogs and price aggregators, which publish their own estimates", () => {
    // These are the pages that would otherwise let someone else's estimate
    // become our value: their titles contain "sold", which classifySaleType
    // reads as a completed sale.
    for (const h of [
      "https://www.soldbrick.com/lego-10255",
      "https://fliptip.ai/price/lego-10255",
      "https://app.brickpicker.com/sets/10255",
      "https://studfinder.app/catalog/sets/10255",
      "https://www.brickeconomy.com/set/10255-1",
      "BRICKECONOMY.COM",
      "",
      null,
    ]) {
      expect(isValuationHost(h)).toBe(false);
    }
  });

  it("counts EUR observations only, so no stale FX rate reaches a valuation", () => {
    expect(isEurObservation("EUR")).toBe(true);
    expect(isEurObservation(undefined)).toBe(true);
    expect(isEurObservation(null)).toBe(true);
    expect(isEurObservation("USD")).toBe(false);
    expect(isEurObservation("GBP")).toBe(false);
  });
});

describe("median", () => {
  it("is the middle of real observations, and null when there are none", () => {
    expect(median([340, 320, 360])).toBe(340);
    expect(median([300, 400])).toBe(350);
    expect(median([])).toBeNull();
    // Zero and negative prices are not observations.
    expect(median([0, -5])).toBeNull();
    expect(median([0, 100, 200])).toBe(150);
  });
});
