/**
 * Turns whatever the client pastes or uploads into analysis rows.
 *
 * Two shapes are supported:
 *   - free text, one set per line, optionally with quantity and paid amount
 *   - spreadsheet rows (already read into objects by the browser), with
 *     headers detected rather than assumed
 *
 * Nothing is inferred beyond what is written. A line with no quantity means
 * one copy; a line with no paid amount means the paid amount is unknown, which
 * is NOT the same as zero and never becomes zero.
 *
 * Header detection covers English and Dutch, since the client's own sheets are
 * Belgian ("aantal", "betaald", "inkoopprijs").
 */

import { LotInputRow } from "./lotAnalysisService";

export interface ParsedBulkInput {
  rows: LotInputRow[];
  /** Lines that could not be read as a set, kept so the client can see them. */
  skipped: Array<{ line: string; reason: string }>;
  /** Which spreadsheet columns were used, for display. */
  columnsUsed?: {
    setNumber?: string;
    owned?: string;
    paidPerSet?: string;
    paidTotal?: string;
  };
}

/** 3-8 digits, optional "-1" style suffix. Covers sets and promotional items. */
const SET_NUMBER_RE = /^(\d{3,8})(-\d{1,2})?$/;

export function looksLikeSetNumber(token: string): boolean {
  return SET_NUMBER_RE.test(token.trim());
}

function cleanToken(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:lego|set|nr|no|artikel)[\s.:#_-]*/i, "")
    .replace(/[^\w-]/g, "")
    // Drop the BrickLink/Rebrickable variant suffix so "10255-1" and "10255"
    // are the same row key. LEGO set numbers themselves carry no hyphen.
    .replace(/-\d{1,2}$/, "")
    .trim();
}

/** Reads a number written in either European or English style. */
export function parseLooseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  let s = raw.trim().replace(/[€$£\s]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1.234,56" style decimal, or a thousands separator in "1,234".
    const after = s.length - lastComma - 1;
    s = after > 0 && after <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* Free text                                                           */
/* ------------------------------------------------------------------ */

/**
 * Accepts, per line:
 *   10255
 *   10255-1
 *   10255 x2
 *   10255, 2
 *   10255, 2, 150.00        (set, quantity, total paid)
 *   10255 | 2 | 150,00
 * Also accepts many set numbers on one line separated by commas or spaces,
 * which is how a list gets pasted out of a chat message.
 */
export function parseFreeText(text: string): ParsedBulkInput {
  const rows: LotInputRow[] = [];
  const skipped: Array<{ line: string; reason: string }> = [];

  const lines = text
    .split(/[\r\n;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    // Skip anything that is plainly a heading rather than data.
    if (/^(new|used|sets?|lot|total|codes?)\s*:?\s*$/i.test(line)) continue;

    const parts = line
      .split(/[,|\t]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // Structured: first field is the set, then quantity, then paid.
    const first = cleanToken(parts[0] ?? "");
    const structured = parts.length >= 2 && looksLikeSetNumber(first);

    if (structured) {
      const owned = parseLooseNumber(parts[1]);
      const paid = parts.length >= 3 ? parseLooseNumber(parts[2]) : null;
      rows.push({
        input: first,
        owned: owned !== null && owned > 0 ? Math.floor(owned) : 1,
        paidTotal: paid,
      });
      continue;
    }

    // Otherwise treat every token on the line as a candidate set number,
    // honouring an "xN" multiplier attached to one of them.
    const tokens = line.split(/\s+/).filter(Boolean);
    let matchedAny = false;

    for (let i = 0; i < tokens.length; i++) {
      const tok = cleanToken(tokens[i]);
      if (!looksLikeSetNumber(tok)) continue;

      let owned = 1;
      const next = tokens[i + 1];
      const mult = next?.match(/^x\s*(\d{1,3})$/i) ?? tokens[i].match(/x(\d{1,3})$/i);
      if (mult) {
        owned = parseInt(mult[1], 10);
        if (next && /^x\s*\d{1,3}$/i.test(next)) i += 1;
      }

      rows.push({ input: tok, owned, paidTotal: null });
      matchedAny = true;
    }

    if (!matchedAny) {
      skipped.push({ line, reason: "No LEGO set number found on this line" });
    }
  }

  return { rows, skipped };
}

/* ------------------------------------------------------------------ */
/* Spreadsheet rows                                                    */
/* ------------------------------------------------------------------ */

type SheetRow = Record<string, unknown>;

const PATTERNS = {
  setNumber: [
    /^(set\s*)?(no|nr|num|number|#)$/i,
    /set\s*(no|nr|num|number|#)/i,
    /^set$/i,
    /^number$/i,
    /artikel(nummer)?/i,
    /lego\s*(no|nr|number|code)/i,
    /^code$/i,
  ],
  owned: [/^(qty|quantity|owned|copies|count|units)$/i, /quantity|owned|copies/i, /aantal/i, /^stuks$/i],
  paidTotal: [
    /paid\s*(total|tot|sum)/i,
    /total\s*paid/i,
    /^(total\s*)?(cost|purchase)\s*total$/i,
    /totaal\s*betaald/i,
    /betaald\s*totaal/i,
  ],
  paidPerSet: [
    /paid\s*(per|each|\/)/i,
    /^paid$/i,
    /purchase\s*price/i,
    /price\s*paid/i,
    /^cost$/i,
    /inkoop(prijs)?/i,
    /^betaald$/i,
  ],
};

function findColumn(headers: string[], patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const hit = headers.find((h) => re.test(h.trim()));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Maps spreadsheet rows onto analysis rows.
 *
 * If no set-number column can be identified, the first column whose values
 * mostly look like set numbers is used. If that also fails, every row is
 * reported as skipped rather than guessed at.
 */
export function parseSheetRows(sheetRows: SheetRow[], headerOverrides?: Partial<Record<keyof typeof PATTERNS, string>>): ParsedBulkInput {
  const rows: LotInputRow[] = [];
  const skipped: Array<{ line: string; reason: string }> = [];

  if (sheetRows.length === 0) {
    return { rows, skipped, columnsUsed: {} };
  }

  const headers = Object.keys(sheetRows[0] ?? {});

  let setCol = headerOverrides?.setNumber ?? findColumn(headers, PATTERNS.setNumber);
  const ownedCol = headerOverrides?.owned ?? findColumn(headers, PATTERNS.owned);
  const paidTotalCol = headerOverrides?.paidTotal ?? findColumn(headers, PATTERNS.paidTotal);
  const paidPerCol = headerOverrides?.paidPerSet ?? findColumn(headers, PATTERNS.paidPerSet);

  if (!setCol) {
    // Fall back to whichever column actually contains set numbers.
    const sample = sheetRows.slice(0, 25);
    let best: { col: string; hits: number } | null = null;
    for (const h of headers) {
      const hits = sample.filter((r) => looksLikeSetNumber(cleanToken(String(r[h] ?? "")))).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { col: h, hits };
    }
    if (best && best.hits >= Math.max(1, Math.floor(sample.length * 0.5))) {
      setCol = best.col;
    }
  }

  if (!setCol) {
    return {
      rows,
      skipped: [{ line: headers.join(", "), reason: "Could not find a column of LEGO set numbers" }],
      columnsUsed: {},
    };
  }

  for (const r of sheetRows) {
    const raw = String(r[setCol] ?? "").trim();
    const token = cleanToken(raw);
    if (!looksLikeSetNumber(token)) {
      if (raw) skipped.push({ line: raw, reason: "Not a LEGO set number" });
      continue;
    }

    const ownedVal = ownedCol ? parseLooseNumber(r[ownedCol]) : null;
    const paidTotalVal = paidTotalCol ? parseLooseNumber(r[paidTotalCol]) : null;
    const paidPerVal = paidPerCol ? parseLooseNumber(r[paidPerCol]) : null;

    rows.push({
      input: token,
      owned: ownedVal !== null && ownedVal > 0 ? Math.floor(ownedVal) : 1,
      paidTotal: paidTotalVal,
      paidPerSet: paidTotalVal === null ? paidPerVal : null,
    });
  }

  return {
    rows,
    skipped,
    columnsUsed: {
      setNumber: setCol,
      owned: ownedCol,
      paidPerSet: paidTotalCol === undefined ? paidPerCol : undefined,
      paidTotal: paidTotalCol,
    },
  };
}
