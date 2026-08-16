"use client";

import { useState } from "react";
import { triggerOutboundSyncAction, resolveReconciliationCorrectionAction } from "@/app/actions/marketplaceActions";

interface DiscrepancyRecord {
  productVariantId: string;
  sku: string;
  productName: string;
  setNumber: string;
  centralQty: number;
  shopifyQty: number;
  diff: number;
}

interface ShopifyReconciliationProps {
  discrepancies: DiscrepancyRecord[];
}

export default function ShopifyReconciliation({ discrepancies: initialDiscrepancies }: ShopifyReconciliationProps) {
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRecord[]>(initialDiscrepancies);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [noteFields, setNoteFields] = useState<Record<string, string>>({});

  const handlePushCentral = async (variantId: string) => {
    setActingId(variantId);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await triggerOutboundSyncAction(variantId);
      if (res.success) {
        setActionSuccess("Central inventory pushed to Shopify. Sync job queued.");
        // Re-calculate local state (assume it matches now)
        setDiscrepancies(prev => prev.filter(d => d.productVariantId !== variantId));
      } else {
        setActionError(res.error || "Failed to push central stock.");
      }
    } catch {
      setActionError("Failed to trigger outbound sync.");
    } finally {
      setActingId(null);
    }
  };

  const handleCorrectLocal = async (variantId: string, diff: number) => {
    setActingId(variantId);
    setActionError(null);
    setActionSuccess(null);

    const notes = noteFields[variantId] || "Local adjustment to match Shopify stock count.";

    try {
      const res = await resolveReconciliationCorrectionAction({
        productVariantId: variantId,
        quantityChange: diff, // E.g. if shopify = 8, central = 7, diff = +1, we add +1 to local stock
        notes,
      });

      if (res.success) {
        setActionSuccess("Local inventory balance successfully corrected. Audit log and sync jobs written.");
        setDiscrepancies(prev => prev.filter(d => d.productVariantId !== variantId));
      } else {
        setActionError(res.error || "Failed to adjust local stock.");
      }
    } catch {
      setActionError("Failed to resolve with local stock correction.");
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {actionSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-bold">
          {actionSuccess}
        </div>
      )}

      {actionError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs font-bold">
          {actionError}
        </div>
      )}

      {discrepancies.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center space-y-2 max-w-lg mx-auto">
          <span className="text-3xl">✓</span>
          <h3 className="font-bold text-white text-base">Perfect alignment!</h3>
          <p className="text-slate-400 text-xs font-medium">
            Shopify available stock levels match central database inventory quantities exactly.
          </p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg flex flex-col">
          <div className="px-6 py-4 border-b border-slate-700 bg-slate-900/60">
            <h3 className="font-bold text-sm text-white">Discrepancy Listing ({discrepancies.length})</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-[10px] font-bold text-slate-400 uppercase bg-slate-900/30">
                  <th className="py-3 px-4">LEGO Product Variant</th>
                  <th className="py-3 px-4 text-center">Central Ledger</th>
                  <th className="py-3 px-4 text-center">Shopify Stock</th>
                  <th className="py-3 px-4 text-center">Difference</th>
                  <th className="py-3 px-4">Notes (For Local Correction)</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-750 text-xs font-semibold">
                {discrepancies.map((rec) => {
                  const isPositive = rec.diff > 0;
                  const isActing = actingId === rec.productVariantId;

                  return (
                    <tr key={rec.productVariantId} className="hover:bg-slate-750/30">
                      <td className="py-3.5 px-4">
                        <div className="text-slate-100 font-bold">{rec.productName}</div>
                        <div className="text-slate-400 font-medium text-[10px] mt-0.5">
                          Set: {rec.setNumber} | SKU: {rec.sku}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center text-slate-200">
                        {rec.centralQty} units
                      </td>
                      <td className="py-3.5 px-4 text-center text-slate-200">
                        {rec.shopifyQty} units
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                          isPositive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                        }`}>
                          {isPositive ? `+${rec.diff}` : rec.diff} remote
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <input
                          type="text"
                          placeholder="Reason for local correction..."
                          value={noteFields[rec.productVariantId] || ""}
                          onChange={e => setNoteFields(prev => ({ ...prev, [rec.productVariantId]: e.target.value }))}
                          className="bg-slate-900 border border-slate-700 text-white rounded px-2.5 py-1 text-xs outline-none focus:border-blue-500 w-full max-w-xs"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handlePushCentral(rec.productVariantId)}
                            disabled={isActing}
                            className="py-1.5 px-3 bg-blue-600/10 hover:bg-blue-600/25 active:bg-blue-600/40 text-blue-400 font-bold text-xs rounded-lg transition-colors border border-blue-500/20"
                          >
                            Push Central
                          </button>
                          <button
                            onClick={() => handleCorrectLocal(rec.productVariantId, rec.diff)}
                            disabled={isActing}
                            className="py-1.5 px-3 bg-emerald-600/10 hover:bg-emerald-600/25 active:bg-emerald-600/40 text-emerald-400 font-bold text-xs rounded-lg transition-colors border border-emerald-500/20"
                          >
                            Adjust Local Ledger
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
