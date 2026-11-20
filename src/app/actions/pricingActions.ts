"use server";

import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { LotInputRow, LotAnalysis, analyseLot } from "@/services/pricing/lotAnalysisService";
import { lookupSets, createEvidenceLookup } from "@/services/pricing/setFacts/setFactsService";

/** Guard against a paste that would fire thousands of outbound lookups. */
const MAX_ROWS = 400;

export interface AnalyzeLotParams {
  rows: LotInputRow[];
  /** One price for the whole lot, when there is no per-set breakdown. */
  lotPaidTotal?: number | null;
  /** Fill missing values from real sold observations across the web. */
  useWebSearch?: boolean;
  forceRefresh?: boolean;
}

export type AnalyzeLotResult =
  | { success: true; data: LotAnalysis }
  | { success: false; error: string };

/**
 * Runs the bulk lot analysis.
 *
 * The analysis quotes real figures only: catalogue RRP and value, and whatever
 * the client actually paid. No shipping, packaging, handling or fee amount is
 * applied anywhere, and a single lot price is never split across sets.
 */
export async function analyzeLotAction(params: AnalyzeLotParams): Promise<AnalyzeLotResult> {
  await checkRole([UserRole.VIEWER, UserRole.FAMILY_SELLER, UserRole.ADMIN]);

  const rows = (params.rows ?? []).filter((r) => r && typeof r.input === "string" && r.input.trim().length > 0);

  if (rows.length === 0) {
    return { success: false, error: "No LEGO set numbers to analyse." };
  }
  if (rows.length > MAX_ROWS) {
    return {
      success: false,
      error: `That is ${rows.length} lines. The limit per run is ${MAX_ROWS} — split the list and run it in batches.`,
    };
  }

  try {
    const factsByInput = await lookupSets(
      rows.map((r) => r.input),
      {
        forceRefresh: params.forceRefresh,
        evidenceLookup: params.useWebSearch ? createEvidenceLookup() : undefined,
      }
    );

    const analysis = analyseLot(rows, factsByInput, {
      lotPaidTotal: params.lotPaidTotal ?? null,
      currency: "EUR",
    });

    return { success: true, data: analysis };
  } catch (err) {
    console.error("[analyzeLotAction] failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "The analysis could not be completed.",
    };
  }
}
