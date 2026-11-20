/**
 * BrickEconomy set-facts client.
 *
 * Credential-free, same approach as bricklinkDirectClient: read the public
 * pages and parse them. Written against the live page structure verified on
 * 20 Nov 2026:
 *
 *   <div class="side-box mt-30 setpricing">
 *     <div class="side-box-head"><h3 class="set-h">Set Pricing</h3></div>
 *     <div class="side-box-body ...">
 *       <div class="row rowlist">
 *         <div class="col-xs-5 text-muted">Retail price</div>
 *         <div class="col-xs-7">€299.99</div>
 *       </div>
 *
 * Section scoping is mandatory, not cosmetic. The same label appears in more
 * than one section with different meanings:
 *   - "Value" appears twice inside Set Pricing: first = new, second = used.
 *   - "Annual growth" appears in Set Pricing (this set) AND in Subtheme
 *     Analysis (the whole subtheme). Reading the wrong one silently reports
 *     another set's growth as this set's.
 *
 * Gift-with-purchase sets report `Retail price = "Free promotional"` and have
 * NO "Growth" row at all. Those are recorded as rrp: null /
 * rrpBasis: "FREE_PROMOTIONAL" and growthVsRrpPct: null — never 0.
 */

import { SetFacts, SetStatus, emptyFacts } from "./types";

const BASE = "https://www.brickeconomy.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const BRICKECONOMY_SOURCE = "BrickEconomy";

/* ------------------------------------------------------------------ */
/* HTML helpers                                                        */
/* ------------------------------------------------------------------ */

export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    // A slice can end mid-tag ("…10255-1</div></div>\n <div"). Drop the
    // dangling opener so it does not survive as literal text.
    .replace(/<[^>]*$/, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&euro;/gi, "€")
    .replace(/&pound;/gi, "£")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RowPair {
  label: string;
  value: string;
}

/**
 * Pulls the body of one `side-box` section, located by its heading text.
 * Slices from the heading to the start of the next side-box.
 */
export function extractSection(html: string, headingText: string): string | null {
  const escaped = headingText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headRe = new RegExp(
    `<div[^>]*class="[^"]*side-box-head[^"]*"[^>]*>\\s*<h\\d[^>]*>\\s*${escaped}\\s*</h\\d>`,
    "i"
  );
  const m = html.match(headRe);
  if (!m || m.index === undefined) return null;

  // The boundary lookahead is load-bearing: `\bside-box\b` would also match
  // `side-box-head` and `side-box-body` (a hyphen is a word boundary), which
  // truncates the slice to a few hundred characters and silently yields no rows.
  const from = m.index + m[0].length;
  const nextBox = html.slice(from).search(/<div[^>]*class="[^"]*side-box(?![-\w])[^"]*"/);
  return nextBox === -1 ? html.slice(from) : html.slice(from, from + nextBox);
}

/**
 * Extracts every label/value pair from a section, in document order.
 * Order matters: the first "Value" is the new price, the second is used.
 */
export function extractRows(sectionHtml: string): RowPair[] {
  const rows: RowPair[] = [];
  const marker = /class="[^"]*\browlist\b[^"]*"/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(sectionHtml)) !== null) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    // The marker matches the class attribute, which sits inside the next row's
    // opening tag. Back up to that tag's "<" so the slice ends cleanly.
    let end = sectionHtml.length;
    if (i + 1 < starts.length) {
      const tagStart = sectionHtml.lastIndexOf("<", starts[i + 1]);
      end = tagStart > starts[i] ? tagStart : starts[i + 1];
    }
    const slice = sectionHtml.slice(starts[i], end);

    const labelMatch = slice.match(/text-muted[^>]*>([\s\S]*?)<\/div>/);
    if (!labelMatch || labelMatch.index === undefined) continue;

    const label = stripTags(labelMatch[1]);
    if (!label) continue;

    const value = stripTags(slice.slice(labelMatch.index + labelMatch[0].length));
    rows.push({ label, value });
  }
  return rows;
}

/** Nth occurrence (0-based) of a label within a section. */
export function pick(rows: RowPair[], label: string, occurrence = 0): string | null {
  const hits = rows.filter((r) => r.label.toLowerCase() === label.toLowerCase());
  const hit = hits[occurrence];
  return hit ? hit.value : null;
}

/* ------------------------------------------------------------------ */
/* Value parsers — all return null rather than a fallback number       */
/* ------------------------------------------------------------------ */

export interface MoneyParse {
  amount: number | null;
  currency: string | null;
  freePromotional: boolean;
}

export function parseMoney(raw: string | null): MoneyParse {
  if (!raw) return { amount: null, currency: null, freePromotional: false };

  if (/free\s*promotional|free\s*gift|gift\s*with\s*purchase/i.test(raw)) {
    return { amount: null, currency: null, freePromotional: true };
  }

  const SYMBOLS: Record<string, string> = { "€": "EUR", "$": "USD", "£": "GBP" };
  const symbolMatch = raw.match(/[€$£]|EUR|USD|GBP/i);
  const currency = symbolMatch
    ? SYMBOLS[symbolMatch[0]] ?? symbolMatch[0].toUpperCase()
    : null;

  // First number in the string. "€373.96 €351.99" -> 373.96
  // The comma branch must require at least one group: with `*` the pattern
  // matches a 3-digit PREFIX of an un-grouped number, turning €1320.59 into
  // 132 and silently undervaluing every four-figure set.
  const numMatch = raw.match(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (!numMatch) return { amount: null, currency, freePromotional: false };

  const amount = parseFloat(numMatch[1].replace(/,/g, ""));
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    freePromotional: false,
  };
}

/** "+6.87%" -> 6.87 | "-3.77%" -> -3.77 | "+25.54% (Since retirement)" -> 25.54 */
export function parsePct(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** "4,002 (PPP €0.07)" -> 4002 */
export function parseCount(raw: string | null): number | null {
  if (!raw) return null;
  // Same alternation trap as parseMoney: `*` would read "2017" as 201.
  const m = raw.match(/(\d{1,3}(?:,\d{3})+|\d+)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseStatus(raw: string | null): SetStatus {
  if (!raw) return "UNKNOWN";
  const s = raw.toLowerCase();
  if (/retiring\s*soon/.test(s)) return "RETIRING_SOON";
  if (/retired/.test(s)) return "RETIRED";
  if (/retail|available/.test(s)) return "RETAIL";
  return "UNKNOWN";
}

/** Keeps the source's own wording ("February 2024", "January 2, 2017"). */
export function parseDateText(raw: string | null): string | null {
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > 0 && clean !== "-" ? clean : null;
}

/** Base set number, suffix stripped: "10255-1" / "LEGO 10255" -> "10255". */
export function baseSetNumber(input: string): string {
  return input
    .trim()
    .replace(/^(?:lego|set)[\s:_-]*/i, "")
    .replace(/-\d+$/, "")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Fetch + resolve                                                     */
/* ------------------------------------------------------------------ */

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

/** Per-request ceiling. Without one, a stalled request hangs the whole run. */
export const FETCH_TIMEOUT_MS = 12_000;

const defaultFetcher: Fetcher = async (url: string) => {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
};

/**
 * Detects a bot-protection interstitial rather than the real page.
 *
 * BrickEconomy is behind Cloudflare, which challenges datacenter IPs far more
 * readily than residential ones. A challenge returns HTTP 403/503 (sometimes
 * even 200) carrying a "Just a moment..." page, which would otherwise parse
 * as "page structure not recognised" and quietly produce a set with no data.
 */
export function looksLikeBotChallenge(status: number, html: string): boolean {
  if (status === 403 || status === 503 || status === 429) return true;
  const head = html.slice(0, 4000).toLowerCase();
  return (
    head.includes("just a moment") ||
    head.includes("cf-browser-verification") ||
    head.includes("cf_chl_opt") ||
    head.includes("challenge-platform") ||
    head.includes("enable javascript and cookies to continue") ||
    head.includes("attention required")
  );
}

/**
 * Resolves a set number to its canonical page path.
 *
 * `/set/10255-1` without the slug returns an error page, so the number must be
 * resolved through search first. The resolved href is verified to carry the
 * requested set number; a non-matching first result is treated as unresolved
 * rather than guessed at.
 */
export interface ResolveOutcome {
  path: string | null;
  /** True when bot protection answered instead of the real search page. */
  blocked: boolean;
  status: number | null;
}

export async function resolveSetPathDetailed(
  setNumber: string,
  fetcher: Fetcher = defaultFetcher
): Promise<ResolveOutcome> {
  const base = baseSetNumber(setNumber);
  if (!base) return { path: null, blocked: false, status: null };

  const res = await fetcher(`${BASE}/search?query=${encodeURIComponent(base)}`);
  if (looksLikeBotChallenge(res.status, res.text)) {
    return { path: null, blocked: true, status: res.status };
  }
  if (!res.ok) return { path: null, blocked: false, status: res.status };

  return { path: findSetHref(res.text, base), blocked: false, status: res.status };
}

/** Back-compat wrapper: the path alone. */
export async function resolveSetPath(
  setNumber: string,
  fetcher: Fetcher = defaultFetcher
): Promise<string | null> {
  return (await resolveSetPathDetailed(setNumber, fetcher)).path;
}

/** Picks the href whose set number matches, rather than trusting result order. */
export function findSetHref(html: string, base: string): string | null {
  const hrefs = [...html.matchAll(/href="(\/set\/[^"]+)"/g)].map((m) => m[1]);
  const seen = new Set<string>();
  for (const href of hrefs) {
    if (seen.has(href)) continue;
    seen.add(href);
    const m = href.match(/^\/set\/(\d+)-\d+/);
    if (m && m[1] === base) return href;
  }
  return null;
}

/**
 * Fetches and parses every KPI for one set. Returns facts with nulls where the
 * source is silent, and a resolutionError when the set could not be found or
 * the page reported a currency other than EUR (mixing currencies silently
 * would corrupt every total downstream).
 */
export async function fetchSetFacts(
  input: string,
  fetcher: Fetcher = defaultFetcher
): Promise<SetFacts> {
  const base = baseSetNumber(input);
  const facts = emptyFacts(input, base);

  let outcome: ResolveOutcome;
  try {
    outcome = await resolveSetPathDetailed(base, fetcher);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    facts.resolutionError = /abort|timeout|timed out/i.test(msg)
      ? `Lookup timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      : `Lookup failed: ${msg}`;
    return facts;
  }

  if (outcome.blocked) {
    facts.resolutionError =
      `Blocked by bot protection (HTTP ${outcome.status}). The source challenges requests ` +
      `from datacenter IPs, so this works from a browser but not from the server.`;
    return facts;
  }
  if (!outcome.path) {
    facts.resolutionError = "Not found on BrickEconomy";
    return facts;
  }
  const path = outcome.path;

  const url = `${BASE}${path}`;
  facts.sourceUrl = url;

  let page: { ok: boolean; status: number; text: string };
  try {
    page = await fetcher(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    facts.resolutionError = /abort|timeout|timed out/i.test(msg)
      ? `Page fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      : `Page fetch failed: ${msg}`;
    return facts;
  }
  if (looksLikeBotChallenge(page.status, page.text)) {
    facts.resolutionError =
      `Blocked by bot protection (HTTP ${page.status}). The source challenges requests from ` +
      `datacenter IPs, so this works from a browser but not from the server.`;
    return facts;
  }
  if (!page.ok) {
    facts.resolutionError = `Page returned HTTP ${page.status}`;
    return facts;
  }

  const html = page.text;
  const detailsHtml = extractSection(html, "Set Details");
  const pricingHtml = extractSection(html, "Set Pricing");

  if (!detailsHtml && !pricingHtml) {
    facts.resolutionError = "Page structure not recognised";
    return facts;
  }

  const addSource = (field: string) => facts.sources.push({ field, source: BRICKECONOMY_SOURCE, url });

  /* ---- Set Details ---- */
  if (detailsHtml) {
    const rows = extractRows(detailsHtml);

    const num = pick(rows, "Set number");
    if (num) facts.setNumber = num.trim();

    facts.name = pick(rows, "Name");
    facts.theme = pick(rows, "Theme");
    facts.subtheme = pick(rows, "Subtheme");
    facts.year = parseCount(pick(rows, "Year"));
    facts.pieces = parseCount(pick(rows, "Pieces"));
    facts.releaseDate = parseDateText(pick(rows, "Released"));
    facts.retirementDate = parseDateText(pick(rows, "Retired"));
    facts.status = parseStatus(pick(rows, "Availability"));

    for (const f of ["name", "theme", "subtheme", "year", "pieces", "releaseDate", "retirementDate", "status"]) {
      addSource(f);
    }
  }

  /* ---- Set Pricing (section-scoped: see file header) ---- */
  if (pricingHtml) {
    const rows = extractRows(pricingHtml);

    const rrp = parseMoney(pick(rows, "Retail price"));
    if (rrp.freePromotional) {
      facts.rrp = null;
      facts.rrpBasis = "FREE_PROMOTIONAL";
    } else if (rrp.amount !== null) {
      facts.rrp = rrp.amount;
      facts.rrpBasis = "RETAIL_PRICE";
    } else {
      facts.rrp = null;
      facts.rrpBasis = "UNKNOWN";
    }

    // Occurrence 0 = new value, occurrence 1 = used value.
    const newVal = parseMoney(pick(rows, "Value", 0));
    const usedVal = parseMoney(pick(rows, "Value", 1));

    const nonEur = [rrp, newVal, usedVal].find((p) => p.currency && p.currency !== "EUR");
    if (nonEur) {
      facts.resolutionError = `Source reported ${nonEur.currency}, not EUR — figures not imported to avoid mixing currencies`;
      return facts;
    }

    facts.currentValueNew = newVal.amount;
    facts.usedValue = usedVal.amount;

    if (facts.currentValueNew !== null) {
      facts.valueBasis = "MARKET_VALUE_NEW";
    } else if (facts.status === "RETAIL" && facts.rrp !== null) {
      // Still on shelves with no secondary market: retail price IS the current
      // value. Same basis BrickEconomy itself uses. Not an estimate.
      facts.currentValueNew = facts.rrp;
      facts.valueBasis = "RETAIL_PRICE";
    } else {
      facts.valueBasis = "NONE";
    }

    // Absent entirely for free-promotional sets: stays null, never 0.
    facts.growthVsRrpPct = parsePct(pick(rows, "Growth"));
    facts.annualGrowthPct = parsePct(pick(rows, "Annual growth"));
    facts.twelveMonthOutlookPct = parsePct(pick(rows, "1-year growth"));

    for (const f of [
      "rrp",
      "currentValueNew",
      "usedValue",
      "growthVsRrpPct",
      "annualGrowthPct",
      "twelveMonthOutlookPct",
    ]) {
      addSource(f);
    }
  }

  return facts;
}
