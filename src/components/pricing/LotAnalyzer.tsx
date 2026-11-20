"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { analyzeLotAction } from "@/app/actions/pricingActions";
import type { LotAnalysis, LotAnalysisRow, LotInputRow } from "@/services/pricing/lotAnalysisService";
import { parseFreeText, parseSheetRows, type ParsedBulkInput } from "@/services/pricing/bulkInputParser";

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

const DASH = "—";

/** Money, or an em dash. A missing figure is never shown as 0.00. */
function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function int(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return n.toLocaleString("en-GB");
}

/** RRP cell: a free set has no retail price, which is not the same as €0. */
function rrpCell(row: LotAnalysisRow): string {
  if (row.rrpBasis === "FREE_PROMOTIONAL") return "Free (GWP)";
  return money(row.rrp);
}

function paidCell(row: LotAnalysisRow): string {
  if (row.paidBasis === "NOT_SUPPLIED") return DASH;
  return money(row.paidTotal);
}

const STATUS_LABEL: Record<string, string> = {
  RETAIL: "At retail",
  RETIRING_SOON: "Retiring soon",
  RETIRED: "Retired",
  UNKNOWN: "Unknown",
};

const STATUS_CLASS: Record<string, string> = {
  RETAIL: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  RETIRING_SOON: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  RETIRED: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  UNKNOWN: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
};

const TONE_CLASS: Record<string, string> = {
  positive: "border-emerald-500/30 bg-emerald-500/5",
  neutral: "border-slate-700 bg-slate-900/60",
  warning: "border-amber-500/30 bg-amber-500/5",
};

const TONE_TEXT: Record<string, string> = {
  positive: "text-emerald-300",
  neutral: "text-white",
  warning: "text-amber-300",
};

/* ------------------------------------------------------------------ */
/* Excel export                                                        */
/* ------------------------------------------------------------------ */

function exportToExcel(analysis: LotAnalysis): void {
  const t = analysis.totals;

  const summary: Array<[string, string | number]> = [
    ["LEGO lot analysis", ""],
    ["Generated", new Date(analysis.generatedAt).toLocaleString("en-GB")],
    ["Currency", t.currency],
    ["", ""],
    ["Sets", t.setCount],
    ["Copies", t.totalCopies],
    ["Resolved", t.resolvedCount],
    ["Not found", t.unresolvedCount],
    ["", ""],
    ["Total RRP", t.totalRrp],
    ["Lines with no RRP", t.rowsMissingRrp],
    ["of which free promotional", t.freePromotionalRows],
    ["", ""],
    ["Total current value", t.totalCurrentValue],
    ["Lines with no current value", t.rowsMissingValue],
    ["", ""],
    ["Paid (per-line total)", t.totalPaidFromRows],
    ["Lines with no paid amount", t.rowsMissingPaid],
    ["Paid on lines with no value (held out of both sides)", t.paidExcludedNoValue],
    ["Lines paid for but unpriced", t.rowsPaidButUnvalued],
    ["Paid (single lot price)", t.lotPaidTotal ?? "not supplied"],
    ["Profit is based on", t.paidBasisUsed === "PER_ROW" ? "per-line paid amounts" : t.paidBasisUsed === "LOT_TOTAL" ? "the single lot price" : "nothing — no paid amount supplied"],
    ["Paid total used", t.effectivePaidTotal ?? "n/a"],
    ["Value covered by that paid total", t.valueCoveredByPaid],
    ["Lines covered", `${t.profitRowsCovered} of ${t.setCount}`],
    ["TOTAL PROFIT (value - paid)", t.totalProfit ?? "n/a"],
    ["Profit %", t.profitPct ?? "n/a"],
    ["", ""],
    ["Retired", t.statusCounts.RETIRED],
    ["Retiring soon", t.statusCounts.RETIRING_SOON],
    ["At retail", t.statusCounts.RETAIL],
    ["Status unknown", t.statusCounts.UNKNOWN],
    ["Share of value in retired sets (%)", t.retiredValueSharePct ?? "n/a"],
    ["", ""],
    ["Method", "Profit is current value minus what was actually paid. No shipping, packaging, handling or marketplace fees are deducted anywhere. A single lot price is never split across sets. Missing figures are excluded from totals rather than estimated."],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 36 }, { wch: 80 }];

  const header = [
    "Set number",
    "Name",
    "Theme",
    "Subtheme",
    "Year",
    "Pieces",
    "Owned",
    "RRP",
    "RRP x qty",
    "Paid per set",
    "Paid total",
    "Release date",
    "Retirement date",
    "Status",
    "Current value (new)",
    "Current value x qty",
    "Used value",
    "Growth vs RRP %",
    "Annual growth %",
    "Profit vs paid",
    "Value basis",
    "Notes",
    "Source",
  ];

  const body = analysis.rows.map((r) => [
    r.setNumber,
    r.name ?? "",
    r.theme ?? "",
    r.subtheme ?? "",
    r.year ?? "",
    r.pieces ?? "",
    r.owned,
    r.rrpBasis === "FREE_PROMOTIONAL" ? "Free (GWP)" : r.rrp ?? "",
    r.rrpLine ?? "",
    r.paidBasis === "NOT_SUPPLIED" ? "" : r.paidPerSet ?? "",
    r.paidBasis === "NOT_SUPPLIED" ? "" : r.paidTotal ?? "",
    r.releaseDate ?? "",
    r.retirementDate ?? "",
    STATUS_LABEL[r.status] ?? r.status,
    r.currentValueNew ?? "",
    r.valueLine ?? "",
    r.usedValue ?? "",
    r.growthVsRrpPct ?? "",
    r.annualGrowthPct ?? "",
    r.profitVsPaid ?? "",
    r.valueBasis,
    r.notes.join(" | "),
    r.sourceUrl ?? "",
  ]);

  const totalRow = [
    "TOTAL",
    `${analysis.totals.setCount} sets`,
    "",
    "",
    "",
    "",
    analysis.totals.totalCopies,
    "",
    analysis.totals.totalRrp,
    "",
    analysis.totals.totalPaidFromRows || "",
    "",
    "",
    "",
    "",
    analysis.totals.totalCurrentValue,
    "",
    "",
    "",
    analysis.totals.totalProfit ?? "",
    "",
    "",
    "",
  ];

  const wsRows = XLSX.utils.aoa_to_sheet([header, ...body, [], totalRow]);
  wsRows["!cols"] = header.map((h, i) =>
    i === 1 ? { wch: 38 } : i === 21 ? { wch: 60 } : i === 22 ? { wch: 46 } : { wch: Math.max(12, h.length + 2) }
  );
  wsRows["!freeze"] = { xSplit: 1, ySplit: 1 };
  wsRows["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
  XLSX.utils.book_append_sheet(wb, wsRows, "Sets");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `lego-lot-analysis-${stamp}.xlsx`);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function LotAnalyzer() {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedBulkInput | null>(null);
  const [lotPaid, setLotPaid] = useState("");
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<LotAnalysis | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Rows that will actually be analysed: an upload wins over the textarea. */
  const pendingRows: LotInputRow[] = useMemo(() => {
    if (parsed) return parsed.rows;
    return text.trim() ? parseFreeText(text).rows : [];
  }, [parsed, text]);

  const pendingSkipped = useMemo(() => {
    if (parsed) return parsed.skipped;
    return text.trim() ? parseFreeText(text).skipped : [];
  }, [parsed, text]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) {
        setError("That file has no readable sheet.");
        return;
      }
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      const result = parseSheetRows(json);
      if (result.rows.length === 0) {
        setError(
          result.skipped[0]?.reason ??
            "No LEGO set numbers were found in that file. Check which column holds the set numbers."
        );
        setParsed(null);
        return;
      }
      setParsed(result);
      setFileName(file.name);
      setText("");
    } catch (err) {
      setError(`Could not read that file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const clearInput = () => {
    setParsed(null);
    setFileName(null);
    setText("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const run = async () => {
    setError(null);
    setRunning(true);
    setAnalysis(null);
    try {
      const lotPaidTotal = lotPaid.trim() ? Number(lotPaid.replace(",", ".")) : null;
      const res = await analyzeLotAction({
        rows: pendingRows,
        lotPaidTotal: Number.isFinite(lotPaidTotal as number) ? lotPaidTotal : null,
        useWebSearch,
      });
      if (res.success) setAnalysis(res.data);
      else setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The analysis failed.");
    } finally {
      setRunning(false);
    }
  };

  const t = analysis?.totals;

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------- Input ---------------- */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Set list</h2>
          <p className="text-xs text-slate-400">
            Paste set numbers, or upload the client&apos;s own spreadsheet
          </p>
        </div>

        {parsed ? (
          <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-white">
                <span className="font-medium">{fileName}</span>
                <span className="text-slate-400"> — {parsed.rows.length} sets read</span>
              </div>
              <button onClick={clearInput} className="text-xs text-slate-400 underline hover:text-white">
                Use a different list
              </button>
            </div>
            {parsed.columnsUsed && (
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                <div>
                  Set numbers: <span className="text-slate-200">{parsed.columnsUsed.setNumber ?? DASH}</span>
                </div>
                <div>
                  Quantity: <span className="text-slate-200">{parsed.columnsUsed.owned ?? "not found — assuming 1"}</span>
                </div>
                <div>
                  Paid: <span className="text-slate-200">{parsed.columnsUsed.paidTotal ?? parsed.columnsUsed.paidPerSet ?? "not found"}</span>
                </div>
              </dl>
            )}
          </div>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={"10255\n40601 x3\n75192, 1, 650.00      (set, quantity, paid)"}
              className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800">
                Upload .xlsx or .csv
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
              <span className="text-xs text-slate-500">
                Quantity and paid columns are picked up automatically when the sheet has them
              </span>
            </div>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-5 border-t border-slate-800 pt-4">
          <div>
            <label className="block text-xs font-medium text-slate-300">
              Paid for the whole lot
              <span className="ml-1 font-normal text-slate-500">(optional)</span>
            </label>
            <input
              value={lotPaid}
              onChange={(e) => setLotPaid(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 300"
              className="mt-1 w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <p className="mt-1 max-w-xs text-[11px] leading-snug text-slate-500">
              Use this when one price covers everything. It stays at lot level and is never split across sets.
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 pb-6 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={useWebSearch}
              onChange={(e) => setUseWebSearch(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950"
            />
            Search the web for prices the catalogue is missing
          </label>

          <div className="ml-auto flex items-center gap-3 pb-6">
            {pendingRows.length > 0 && (
              <span className="text-xs text-slate-400">{pendingRows.length} sets ready</span>
            )}
            <button
              onClick={run}
              disabled={running || pendingRows.length === 0}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {running ? "Analysing…" : "Run analysis"}
            </button>
          </div>
        </div>

        {pendingSkipped.length > 0 && (
          <p className="mt-3 text-xs text-amber-300">
            {pendingSkipped.length} line{pendingSkipped.length === 1 ? "" : "s"} could not be read as a set number:{" "}
            <span className="text-amber-200/80">
              {pendingSkipped.slice(0, 4).map((s) => s.line).join(", ")}
              {pendingSkipped.length > 4 ? "…" : ""}
            </span>
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </section>

      {running && (
        <p className="text-sm text-slate-400">
          Looking up {pendingRows.length} sets. Each one is fetched from the catalogue
          {useWebSearch ? ", with a web search where the catalogue has no price" : ""}.
        </p>
      )}

      {/* ---------------- Insights ---------------- */}
      {analysis && t && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {analysis.insights.map((ins) => (
              <div key={ins.title} className={`rounded-xl border p-4 ${TONE_CLASS[ins.tone]}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{ins.title}</p>
                <p className={`mt-2 text-xl font-bold leading-tight ${TONE_TEXT[ins.tone]}`}>{ins.headline}</p>
                <p className="mt-2 text-xs leading-snug text-slate-400">{ins.detail}</p>
              </div>
            ))}
          </section>

          {/* ---------------- Lot totals ---------------- */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Lot totals</h2>
              <button
                onClick={() => exportToExcel(analysis)}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Download Excel
              </button>
            </div>

            <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { k: "Sets / copies", v: `${int(t.setCount)} / ${int(t.totalCopies)}` },
                { k: "Total RRP", v: money(t.totalRrp) },
                { k: "Total current value", v: money(t.totalCurrentValue) },
                {
                  k: "Total paid",
                  v: t.effectivePaidTotal === null ? DASH : money(t.effectivePaidTotal),
                },
                {
                  k: "Profit (value − paid)",
                  v: t.totalProfit === null ? DASH : money(t.totalProfit),
                  strong: true,
                  tone: t.totalProfit === null ? "neutral" : t.totalProfit >= 0 ? "positive" : "warning",
                },
              ].map((cell) => (
                <div key={cell.k} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{cell.k}</dt>
                  <dd
                    className={`mt-1 ${cell.strong ? "text-lg font-bold" : "text-base font-semibold"} ${
                      cell.tone ? TONE_TEXT[cell.tone] : "text-white"
                    }`}
                  >
                    {cell.v}
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Profit is current value minus what was actually paid. Nothing is deducted for shipping,
              packaging, handling or marketplace fees.{" "}
              {t.paidBasisUsed === "PER_ROW" &&
                `It covers the ${t.profitRowsCovered} of ${t.setCount} lines that carry both a paid amount and a value.`}
              {t.paidBasisUsed === "PER_ROW" && t.rowsPaidButUnvalued > 0 &&
                ` ${money(t.paidExcludedNoValue)} paid on ${t.rowsPaidButUnvalued} line${
                  t.rowsPaidButUnvalued === 1 ? "" : "s"
                } we could not price is held out of both sides, rather than charged against zero value.`}
              {t.paidBasisUsed === "LOT_TOTAL" &&
                "It compares the whole lot's value against the single price paid, which is not split across sets."}
              {t.paidBasisUsed === "NONE" && "No paid amount was supplied, so no profit is shown."}
            </p>
          </section>

          {/* ---------------- Row table ---------------- */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/50">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">Per-set breakdown</h2>
              <span className="text-xs text-slate-500">{analysis.rows.length} rows</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] text-left text-xs">
                <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {[
                      "Set",
                      "Name",
                      "Theme",
                      "Subtheme",
                      "Year",
                      "Pieces",
                      "Qty",
                      "RRP",
                      "RRP x qty",
                      "Paid",
                      "Released",
                      "Retired",
                      "Status",
                      "Current value",
                      "Value x qty",
                      "Used value",
                      "vs RRP",
                      "Annual",
                      "Profit",
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {analysis.rows.map((r, i) => (
                    <tr key={`${r.setNumber}-${i}`} className="hover:bg-slate-800/30">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">
                        {r.sourceUrl ? (
                          <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-sky-300 hover:underline">
                            {r.setNumber}
                          </a>
                        ) : (
                          r.setNumber
                        )}
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-2 text-slate-300" title={r.name ?? ""}>
                        {r.name ?? <span className="text-slate-600">not found</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.theme ?? DASH}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.subtheme ?? DASH}</td>
                      <td className="px-3 py-2 text-slate-400">{r.year ?? DASH}</td>
                      <td className="px-3 py-2 text-slate-400">{int(r.pieces)}</td>
                      <td className="px-3 py-2 font-medium text-slate-200">{r.owned}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{rrpCell(r)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{money(r.rrpLine)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{paidCell(r)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.releaseDate ?? DASH}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{r.retirementDate ?? DASH}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_CLASS[r.status]}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-white">
                        {money(r.currentValueNew)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-white">{money(r.valueLine)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{money(r.usedValue)}</td>
                      <td
                        className={`whitespace-nowrap px-3 py-2 ${
                          r.growthVsRrpPct === null
                            ? "text-slate-600"
                            : r.growthVsRrpPct >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                        }`}
                      >
                        {pct(r.growthVsRrpPct)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{pct(r.annualGrowthPct)}</td>
                      <td
                        className={`whitespace-nowrap px-3 py-2 font-semibold ${
                          r.profitVsPaid === null
                            ? "text-slate-600"
                            : r.profitVsPaid >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                        }`}
                      >
                        {money(r.profitVsPaid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-700 bg-slate-950/70 font-semibold text-white">
                  <tr>
                    <td className="px-3 py-2">TOTAL</td>
                    <td className="px-3 py-2 text-slate-400">{t.setCount} sets</td>
                    <td colSpan={4} />
                    <td className="px-3 py-2">{int(t.totalCopies)}</td>
                    <td />
                    <td className="whitespace-nowrap px-3 py-2">{money(t.totalRrp)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {t.totalPaidFromRows > 0 ? money(t.totalPaidFromRows) : DASH}
                    </td>
                    <td colSpan={4} />
                    <td className="whitespace-nowrap px-3 py-2">{money(t.totalCurrentValue)}</td>
                    <td colSpan={3} />
                    <td
                      className={`whitespace-nowrap px-3 py-2 ${
                        t.totalProfit === null ? "text-slate-600" : t.totalProfit >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.totalProfit === null ? DASH : money(t.totalProfit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {analysis.rows.some((r) => r.notes.length > 0) && (
              <div className="border-t border-slate-800 px-5 py-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Lines with something worth knowing
                </p>
                <ul className="space-y-1 text-xs text-slate-400">
                  {analysis.rows
                    .filter((r) => r.notes.length > 0)
                    .slice(0, 12)
                    .map((r, i) => (
                      <li key={`${r.setNumber}-note-${i}`}>
                        <span className="font-mono text-slate-300">{r.setNumber}</span>{" "}
                        {r.name ? <span className="text-slate-500">{r.name} — </span> : null}
                        {r.notes.join("; ")}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
