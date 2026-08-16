"use client";

import { useState } from "react";
import { acceptPriceRecommendationAction } from "@/app/actions/marketplaceActions";
import Link from "next/link";

interface ListingInfo {
  id: string;
  marketplace: string;
  price: number;
}

interface RecommendationCard {
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
    cost: number;
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAccept = async (recId: string) => {
    setActingId(recId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await acceptPriceRecommendationAction(recId);
      if (res.success) {
        setSuccessMsg("Recommendation accepted. Listing prices updated and sync jobs queued.");
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

  const fmt = (val: number) => {
    return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(val);
  };

  return (
    <div className="space-y-6">
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
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center space-y-2 max-w-lg mx-auto">
          <span className="text-3xl">✓</span>
          <h3 className="font-bold text-white text-base">Perfect margins!</h3>
          <p className="text-slate-400 text-xs font-medium">
            There are no active pricing recommendations to review at this time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 max-w-4xl">
          {recommendations.map((rec) => {
            const margin = rec.recommendedPrice > 0
              ? ((rec.recommendedPrice - rec.variant.cost) / rec.recommendedPrice) * 100
              : 0;
            const isActing = actingId === rec.id;

            return (
              <div
                key={rec.id}
                className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-md flex flex-col"
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

                  {/* Pricing Comparison */}
                  <div className="flex gap-6 shrink-0 bg-slate-900/50 border border-slate-750 px-4 py-3 rounded-lg text-center">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                        Avg Cost
                      </span>
                      <span className="text-xs font-bold text-slate-200 block mt-0.5">
                        {fmt(rec.variant.cost)}
                      </span>
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
                      <span className={`text-xs font-black block mt-0.5 ${
                        margin > 30 ? "text-emerald-400" : margin > 15 ? "text-amber-400" : "text-rose-400"
                      }`}>
                        {margin.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Reasoning Details */}
                <div className="p-6 bg-slate-900/40 space-y-4">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                      Market Intelligence Reasoning
                    </span>
                    <p className="text-xs text-slate-300 font-medium leading-relaxed">
                      {rec.reasoning}
                    </p>
                  </div>

                  {/* Existing Listings Prices */}
                  {rec.variant.listings.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block">
                        Current Connected Listing Prices:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {rec.variant.listings.map(l => (
                          <div
                            key={l.id}
                            className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-[10px] font-semibold text-slate-200"
                          >
                            <span className="text-slate-400 uppercase mr-1">{l.marketplace}:</span>
                            {fmt(l.price)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Accept action */}
                  {userRole !== "VIEWER" && (
                    <div className="flex justify-end pt-2 border-t border-slate-750/30">
                      <button
                        onClick={() => handleAccept(rec.id)}
                        disabled={isActing}
                        className="py-1.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors shadow-md shadow-blue-500/10"
                      >
                        {isActing ? "Syncing..." : "Accept and Sync Price"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
