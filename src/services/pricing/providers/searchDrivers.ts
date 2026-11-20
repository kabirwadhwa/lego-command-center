/**
 * Web search drivers.
 *
 * Deliberately free of Prisma and of any other import that needs a generated
 * client, so the parsing can be unit-tested directly.
 *
 * Driver order is set by WebSearchProvider: keyed engines first, then
 * DuckDuckGo, which needs no credentials and therefore always works.
 */

export interface SearchResultItem {
  title: string;
  snippet: string;
  link: string;
  pagemap?: Record<string, unknown>;
}

export interface ISearchDriver {
  name: string;
  isConfigured(): boolean;
  search(query: string): Promise<SearchResultItem[]>;
}

/** Per-request ceiling, so a stalled search cannot hang an analysis run. */
export const SEARCH_TIMEOUT_MS = 10_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Shared tag stripper for search-result HTML. */
export function stripSearchHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*$/, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&euro;/gi, "€")
    .replace(/&pound;/gi, "£")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The driver line-up, in priority order: keyed engines first because they are
 * higher quality when configured, then DuckDuckGo, which needs no credentials
 * and so guarantees web search always has a working engine.
 */
export function createDefaultDrivers(): ISearchDriver[] {
  return [
    new GoogleCustomSearchDriver(),
    new SerpApiDriver(),
    new BraveSearchDriver(),
    new DuckDuckGoHtmlDriver(),
  ];
}

/** First configured driver, or null if somehow none are. */
export function selectActiveDriver(drivers: ISearchDriver[]): ISearchDriver | null {
  return drivers.find((d) => d.isConfigured()) ?? null;
}

/** Google Custom Search JSON API. */
export class GoogleCustomSearchDriver implements ISearchDriver {
  name = "Google Custom Search";

  isConfigured(): boolean {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID;
    return !!(key && cx);
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const key = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID;
    if (!key || !cx) return [];

    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Search API HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const items = data?.items || [];
    return items.map(
      (it: { title?: string; snippet?: string; link?: string; pagemap?: Record<string, unknown> }) => ({
        title: it.title || "",
        snippet: it.snippet || "",
        link: it.link || "",
        pagemap: it.pagemap,
      })
    );
  }
}

/** SerpAPI. */
export class SerpApiDriver implements ISearchDriver {
  name = "SerpAPI";

  isConfigured(): boolean {
    return !!process.env.SERPAPI_API_KEY;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) return [];

    const url = `https://serpapi.com/search.json?engine=google&api_key=${apiKey}&q=${encodeURIComponent(query)}&num=10`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SerpAPI HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = data?.organic_results || [];
    return results.map((r: { title?: string; snippet?: string; link?: string }) => ({
      title: r.title || "",
      snippet: r.snippet || "",
      link: r.link || "",
    }));
  }
}

/** Brave Search API. */
export class BraveSearchDriver implements ISearchDriver {
  name = "Brave Search API";

  isConfigured(): boolean {
    return !!process.env.BRAVE_SEARCH_API_KEY;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) return [];

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave Search HTTP ${res.status}`);
    }

    const data = await res.json();
    const results = data?.web?.results || [];
    return results.map((r: { title?: string; description?: string; url?: string }) => ({
      title: r.title || "",
      snippet: r.description || "",
      link: r.url || "",
    }));
  }
}

/**
 * DuckDuckGo HTML endpoint. Needs NO API key, so web search works out of the
 * box instead of lying dormant until someone sets a key.
 *
 * Verified against the live endpoint on 20 Nov 2026:
 *   <div class="result results_links results_links_deep web-result ">
 *     <h2 class="result__title">
 *       <a rel="nofollow" class="result__a"
 *          href="//duckduckgo.com/l/?uddg=<URL-ENCODED>&amp;rut=...">TITLE</a>
 *     <a class="result__snippet" href="...">SNIPPET</a>
 *
 * Every href is a DuckDuckGo redirect, so the destination must be decoded out
 * of the `uddg` parameter. Skip that and every observation's marketplace
 * resolves to "DUCKDUCKGO.COM" and the real host is lost.
 */
export class DuckDuckGoHtmlDriver implements ISearchDriver {
  name = "DuckDuckGo (no key required)";

  /** Always available: there is no credential to configure. */
  isConfigured(): boolean {
    return true;
  }

  /** Pulls the real target URL out of a DuckDuckGo redirect href. */
  static resolveHref(href: string): string | null {
    if (!href) return null;
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        return decodeURIComponent(uddg[1]);
      } catch {
        return null;
      }
    }
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("http")) return href;
    return null;
  }

  async search(query: string): Promise<SearchResultItem[]> {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo HTML HTTP ${res.status}`);
    }

    const html = await res.text();
    const items: SearchResultItem[] = [];

    // Slice the page into result blocks, then read each one.
    const marker = /class="[^"]*\bresult\b[^"]*results_links[^"]*"/g;
    const starts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = marker.exec(html)) !== null) starts.push(m.index);

    for (let i = 0; i < starts.length; i++) {
      let end = html.length;
      if (i + 1 < starts.length) {
        const tagStart = html.lastIndexOf("<", starts[i + 1]);
        end = tagStart > starts[i] ? tagStart : starts[i + 1];
      }
      const block = html.slice(starts[i], end);

      const anchor =
        block.match(/class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ??
        block.match(/href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (!anchor) continue;

      const link = DuckDuckGoHtmlDriver.resolveHref(anchor[1].replace(/&amp;/g, "&"));
      if (!link) continue;

      const snippetMatch =
        block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/) ??
        block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/);

      items.push({
        title: stripSearchHtml(anchor[2]),
        snippet: snippetMatch ? stripSearchHtml(snippetMatch[1]) : "",
        link,
      });

      if (items.length >= 10) break;
    }

    return items;
  }
}
