"use client";

import { useState } from "react";
import { AlertType, AlertSeverity } from "@prisma/client";
import { resolveUnmatchedSkuAction } from "@/app/actions/marketplaceActions";

interface AlertConfig {
  id: string;
  productVariantId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  resolved: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
}

interface VariantOption {
  id: string;
  sku: string;
  condition: string;
  product: {
    name: string;
    setNumber: string;
  };
}

interface AlertsManagerProps {
  initialAlerts: AlertConfig[];
  catalogVariants: VariantOption[];
}

export default function AlertsManager({ initialAlerts, catalogVariants }: AlertsManagerProps) {
  const [alerts, setAlerts] = useState<AlertConfig[]>(initialAlerts);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  
  // Resolution form state
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [resolutionType, setResolutionType] = useState<"PERMANENT" | "ONE_TIME">("PERMANENT");
  const [executing, setExecuting] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  const startResolution = (alertId: string) => {
    setResolvingId(alertId);
    setSelectedVariantId(catalogVariants[0]?.id || "");
    setResolutionType("PERMANENT");
    setResolutionError(null);
  };

  const handleResolve = async (alertId: string) => {
    if (!selectedVariantId) {
      alert("Please select a target catalog variant.");
      return;
    }

    setExecuting(true);
    setResolutionError(null);

    try {
      const res = await resolveUnmatchedSkuAction(alertId, selectedVariantId, resolutionType);
      if (res.success) {
        // Remove from list
        setAlerts(prev => prev.filter(a => a.id !== alertId));
        setResolvingId(null);
      } else {
        setResolutionError(res.error || "Failed to resolve unmatched SKU.");
      }
    } catch {
      setResolutionError("An unexpected error occurred during resolution.");
    } finally {
      setExecuting(false);
    }
  };

  const parseUnmatchedOrderDetails = (message: string) => {
    // Expected format: UNMATCHED_ORDER | Event: {eventId} | Order: {orderId} | SKU: {sku} | Details: {details}
    const parts = message.split(" | ");
    const orderPart = parts.find(p => p.startsWith("Order:"));
    const skuPart = parts.find(p => p.startsWith("SKU:"));
    const detailsPart = parts.find(p => p.startsWith("Details:"));

    return {
      orderId: orderPart ? orderPart.replace("Order:", "").trim() : "Unknown",
      sku: skuPart ? skuPart.replace("SKU:", "").trim() : "Unknown",
      details: detailsPart ? detailsPart.replace("Details:", "").trim() : message,
    };
  };

  return (
    <div className="space-y-6">
      {alerts.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center space-y-2 max-w-lg mx-auto">
          <span className="text-3xl">✓</span>
          <h3 className="font-bold text-white text-base">All clear!</h3>
          <p className="text-slate-400 text-xs font-medium">
            There are no unresolved operational or integration alerts at this time.
          </p>
        </div>
      ) : (
        <div className="space-y-4 max-w-4xl">
          {alerts.map((a) => {
            const isCritical = a.severity === AlertSeverity.CRITICAL;
            const isWarning = a.severity === AlertSeverity.WARNING;
            const isUnmatched = a.type === AlertType.UNMATCHED_ORDER;
            const details = isUnmatched ? parseUnmatchedOrderDetails(a.message) : null;
            const isResolving = resolvingId === a.id;

            return (
              <div
                key={a.id}
                className={`bg-slate-800 border rounded-xl overflow-hidden shadow-md ${
                  isCritical 
                    ? "border-rose-500/30" 
                    : isWarning 
                    ? "border-amber-500/30" 
                    : "border-slate-700"
                }`}
              >
                {/* Alert Item */}
                <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                        isCritical 
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/25" 
                          : isWarning 
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/25" 
                          : "bg-blue-500/10 text-blue-400 border border-blue-500/25"
                      }`}>
                        {a.type.replace("_", " ")}
                      </span>
                      <span className="text-slate-400 text-[10px] font-medium">
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {isUnmatched && details ? (
                      <div className="space-y-1">
                        <p className="text-white text-xs font-bold leading-relaxed">
                          Unmatched SKU <code className="bg-slate-900 px-1.5 py-0.5 rounded text-rose-400 font-mono">{details.sku}</code> detected in order <span className="text-slate-200">#{details.orderId}</span>
                        </p>
                        <p className="text-slate-400 text-[11px] leading-relaxed">{details.details}</p>
                      </div>
                    ) : (
                      <p className="text-slate-100 text-xs font-semibold leading-relaxed">{a.message}</p>
                    )}
                  </div>

                  {isUnmatched && !isResolving && (
                    <button
                      onClick={() => startResolution(a.id)}
                      className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors shrink-0 shadow-md shadow-blue-500/10"
                    >
                      Resolve Mismatch
                    </button>
                  )}
                </div>

                {/* Inline Resolution form */}
                {isResolving && isUnmatched && details && (
                  <div className="bg-slate-900/50 border-t border-slate-700 p-6 space-y-4">
                    <h4 className="font-bold text-xs text-white">Resolve Unmatched SKU Mapping</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Select target Variant */}
                      <div className="space-y-1.5">
                        <label className="text-slate-400 text-xs font-semibold block">Map to Catalog Variant</label>
                        <select
                          value={selectedVariantId}
                          onChange={e => setSelectedVariantId(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:border-blue-500"
                        >
                          {catalogVariants.map(v => (
                            <option key={v.id} value={v.id}>
                              {v.product.name} ({v.product.setNumber}) - SKU: {v.sku} [{v.condition}]
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Select resolution strategy */}
                      <div className="space-y-1.5">
                        <label className="text-slate-400 text-xs font-semibold block">Resolution Strategy</label>
                        <div className="flex gap-4 items-center h-9">
                          <label className="text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="resType"
                              checked={resolutionType === "PERMANENT"}
                              onChange={() => setResolutionType("PERMANENT")}
                              className="bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
                            />
                            Permanent mapping (updates variant SKU)
                          </label>
                          <label className="text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="resType"
                              checked={resolutionType === "ONE_TIME"}
                              onChange={() => setResolutionType("ONE_TIME")}
                              className="bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
                            />
                            One-time mapping (modifies order payload)
                          </label>
                        </div>
                      </div>
                    </div>

                    {resolutionError && (
                      <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs font-bold">
                        {resolutionError}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 justify-end pt-2">
                      <button
                        onClick={() => setResolvingId(null)}
                        disabled={executing}
                        className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-350 font-bold text-xs rounded-lg transition-colors border border-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleResolve(a.id)}
                        disabled={executing}
                        className="py-1.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors shadow-md shadow-blue-500/10"
                      >
                        {executing ? "Reprocessing..." : "Resolve and Reprocess Order"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
