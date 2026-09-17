"use client";

import { useState } from "react";
import {
  acceptPriceRecommendationAction,
  runPricingEngineAction,
  refreshMarketPricesAction
} from "@/app/actions/marketplaceActions";
import Link from "next/link";

interface ListingInfo {
  id: string;
  marketplace: string;
  price: number;
}

export interface RecommendationCard {
  id: string;
  recommendedPrice: number;
  reasoning: string;
  updatedAt: Date;
  variant: {
    id: string;
    sku: string;
    condition: string;
    productName: string;
    setNumber: string;
    cost: number | null;
    costBasisStatus?: "FULLY_KNOWN" | "PARTIALLY_KNOWN" | "COMPLETELY_UNKNOWN";
    listings: ListingInfo[];
  };
}

interface PricingManagerProps {
  initialRecommendations: RecommendationCard[];
  userRole: string;
}

export default function PricingManager({ initialRecommendations, userRole }: PricingManagerProps) {
  const [recommendations, setRecommendations] = useState<RecommendationCard[]>(initialRecommendations);
  const [actingId, setActingId] = useState<string | null>(null);
  const [isSweeping, setIsSweeping] = useState(false);
  const [refreshingSet, setRefreshingSet] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const canEdit = userRole === "ADMIN" || userRole === "FAMILY_SELLER";

  const handleAccept = async (recId: string) => {
    if (!canEdit) {
      setErrorMsg("Insufficient permissions: Only Admins and Family Sellers may accept price changes.");
      return;
    }
    setActingId(recId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await acceptPriceRecommendationAction(recId);
      if (res.success) {
        setSuccessMsg("Recommendation accepted. Listing prices updated and channel sync queued.");
        setRecommendations(prev => prev.filter(r => r.id !== recId));
      } else {
        setErrorMsg(res.error || "Failed to accept pricing suggestion.");
      }
    } catch {
      setErrorMsg("Failed to execute price recommendation.");
    } finally {
      setActingId(null);
    }
  };

  const handleRunEngine = async () => {
    if (!canEdit) {
      setErrorMsg("Insufficient permissions: Only Admins and Family Sellers may run pricing sweeps.");
      return;
    }
    setIsSweeping(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await runPricingEngineAction();
      if (res.success) {
        const processedCount = res.data && "processed" in res.data ? res.data.processed : 1;
        setSuccessMsg(`Pricing engine evaluated ${processedCount} sets and updated recommendations.`);
        window.location.reload();
      } else {
        setErrorMsg(res.error || "Failed to run pricing sweep.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pricing sweep failed.";
      setErrorMsg(msg);
    } finally {
      setIsSweeping(false);
    }
  };

  const handleRefreshSet = async (setNumber: string) => {
    setRefreshingSet(setNumber);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await refreshMarketPricesAction(setNumber);
      if (res.success) {
        setSuccessMsg(`Refreshed ${res.count} live Catawiki observations for Set ${setNumber}.`);
        window.location.reload();
      } else {
        setErrorMsg(res.error || `Failed to refresh Catawiki data for ${setNumber}.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch Catawiki observations.";
      setErrorMsg(msg);
    } finally {
      setRefreshingSet(null);
    }
  };

  const fmt = (val: number | null) => {
    if (val === null || val === undefined) return "Unknown";
    return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(val);
  };

  // Helper to parse confidence score from reasoning
  const extractConfidence = (reasoning: string) => {
    const match = reasoning.match(/Confidence score:\s*(\d+)%/i);
    if (match) return parseInt(match[1], 10);
    return 75; // Default reasonable baseline
  };

  return (
    <div className="space-y-6">
      {/* Top Action Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-3">
          <span className="text-xl">📊</span>
          <div>
            <div className="text-sm font-bold text-white">Active Recommendations: {recommendations.length}</div>
            <div className="text-xs text-slate-400">Deterministic median algorithms with outlier trimming & margin guards</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunEngine}
            disabled={isSweeping}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer"
          >
            <span>{isSweeping ? "⏳" : "⚡"}</span>
            <span>{isSweeping ? "Evaluating Portfolio..." : "Run Pricing Engine Sweep"}</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold">
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs font-bold">
          {errorMsg}
        </div>
      )}

      {recommendations.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center space-y-3 max-w-lg mx-auto">
          <span className="text-4xl">✓</span>
          <h3 className="font-bold text-white text-lg">Portfolio Margins Optimized!</h3>
          <p className="text-slate-400 text-xs font-medium">
            There are no active pricing recommendations pending review. Click &quot;Run Pricing Engine Sweep&quot; to scan the catalog against the latest Catawiki market observations.
          </p>
          <button
            onClick={handleRunEngine}
            disabled={isSweeping || !canEdit}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg"
          >
            {isSweeping ? "Running Sweep..." : "Run Pricing Engine Now"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 max-w-4xl">
          {recommendations.map((rec) => {
            const hasKnownCost = rec.variant.cost !== null && rec.variant.cost > 0;
            const margin = hasKnownCost && rec.recommendedPrice > 0
              ? ((rec.recommendedPrice - (rec.variant.cost as number)) / rec.recommendedPrice) * 100
              : null;
            const netProfit = hasKnownCost && rec.recommendedPrice > 0
              ? rec.recommendedPrice - (rec.variant.cost as number)
              : null;
            const isActing = actingId === rec.id;
            const isRefreshing = refreshingSet === rec.variant.setNumber;
            const confidence = extractConfidence(rec.reasoning);

            return (
              <div
                key={rec.id}
                className="bg-slate-800/90 border border-slate-700 rounded-xl overflow-hidden shadow-lg flex flex-col transition-all hover:border-slate-600"
              >
                {/* Header info */}
                <div className="p-6 border-b border-slate-750 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-slate-900 text-slate-300 border border-slate-700">
                        Set {rec.variant.setNumber}
                      </span>
                      <span className="text-slate-400 text-[10px] font-semibold uppercase">
                        {rec.variant.condition.replace("_", " ")}
                      </span>
                      {/* Confidence Score Badge */}
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                        confidence >= 80
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : confidence >= 50
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}>
                        {confidence}% Confidence
                      </span>
                    </div>
                    <Link
                      href={`/inventory/${rec.variant.id}`}
                      className="text-white font-bold hover:text-blue-400 transition-colors block text-base"
                    >
                      {rec.variant.productName}
                    </Link>
                    <div className="text-[10px] text-slate-400 font-semibold font-mono">
                      SKU: {rec.variant.sku}
                    </div>
                  </div>

                  {/* Pricing Comparison Stats */}
                  <div className="flex gap-6 shrink-0 bg-slate-900/70 border border-slate-750 px-4 py-3 rounded-lg text-center">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                        Avg Cost
                      </span>
                      <span className="text-xs font-bold text-slate-200 block mt-0.5">
                        {fmt(rec.variant.cost)}
                      </span>
                      {rec.variant.costBasisStatus === "PARTIALLY_KNOWN" && (
                        <span className="text-[8px] text-amber-400 block font-medium">Partial Basis</span>
                      )}
                    </div>
                    <div className="border-l border-slate-750 h-8 self-center" />
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                        Suggested Price
                      </span>
                      <span className="text-xs font-black text-blue-400 block mt-0.5">
                        {fmt(rec.recommendedPrice)}
                      </span>
                    </div>
                    <div className="border-l border-slate-750 h-8 self-center" />
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                        Est. Margin
                      </span>
                      {margin !== null ? (
                        <span className={`text-xs font-black block mt-0.5 ${
                          margin > 30 ? "text-emerald-400" : margin > 15 ? "text-amber-400" : "text-rose-400"
                        }`}>
                          {margin.toFixed(1)}% (+{fmt(netProfit)})
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-400 block mt-0.5">
                          N/A (Unknown Basis)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Reasoning Box & Market Evidence */}
                <div className="p-6 bg-slate-850/50 flex flex-col gap-4">
                  <div className="text-xs font-medium text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-750">
                    <span className="font-bold text-blue-400 mr-1">Algorithm Rationale:</span>
                    {rec.reasoning}
                  </div>

                  {/* Current Active Listings */}
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-bold text-slate-300">Active Channel Listings:</span>
                    {rec.variant.listings.length === 0 ? (
                      <span className="italic">No channel listings currently active</span>
                    ) : (
                      rec.variant.listings.map((l) => (
                        <span
                          key={l.id}
                          className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono text-slate-200"
                        >
                          {l.marketplace}: {fmt(l.price)}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="p-4 bg-slate-900 border-t border-slate-750 flex items-center justify-between gap-3">
                  <button
                    onClick={() => handleRefreshSet(rec.variant.setNumber)}
                    disabled={isRefreshing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 disabled:bg-slate-850 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer"
                  >
                    <span>{isRefreshing ? "⏳" : "🔄"}</span>
                    <span>{isRefreshing ? "Refreshing Catawiki..." : "Refresh Catawiki Bids"}</span>
                  </button>

                  <div className="flex items-center gap-3">
                    <Link
                      href={`/inventory/${rec.variant.id}`}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Inspect Variant
                    </Link>

                    <button
                      onClick={() => handleAccept(rec.id)}
                      disabled={isActing || !canEdit}
                      title={!canEdit ? "View Only: Admin or Family Seller required" : undefined}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-750 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span>{isActing ? "⏳" : "✓"}</span>
                      <span>{isActing ? "Applying..." : canEdit ? "Accept & Sync Price" : "View Only"}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
