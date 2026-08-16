"use client";

import { useTransition, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { createManualSaleAction } from "@/app/actions/inventoryActions";
import { X } from "lucide-react";

interface SellModalProps {
  variants: {
    id: string;
    sku: string;
    product: {
      setNumber: string;
      name: string;
    };
    condition: string;
  }[];
  accounts: {
    id: string;
    name: string;
    type: string;
  }[];
}

export default function SellModal({ variants, accounts }: SellModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const isOpen = searchParams.get("action") === "sell";
  const skuParam = searchParams.get("sku") || "";

  // Find variant ID from SKU parameter if passed
  const matchedVariant = skuParam
    ? variants.find((v) => v.sku === skuParam)
    : null;

  const [selectedVariantId, setSelectedVariantId] = useState(matchedVariant?.id || "");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitSalePrice, setUnitSalePrice] = useState("");
  const [notes, setNotes] = useState("");
  
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const handleClose = () => {
    setErrorMsg("");
    setQuantity("1");
    setUnitSalePrice("");
    setNotes("");
    // Strip action parameter from URL
    const params = new URLSearchParams(searchParams);
    params.delete("action");
    params.delete("sku");
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const variantId = selectedVariantId || matchedVariant?.id;
    if (!variantId) return setErrorMsg("Please select a product variant.");
    if (!selectedAccountId) return setErrorMsg("Target inventory account is required.");

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) return setErrorMsg("Quantity must be a positive integer.");

    const price = parseFloat(unitSalePrice);
    if (isNaN(price) || price < 0) return setErrorMsg("Unit selling price must be a non-negative number.");

    startTransition(async () => {
      const res = await createManualSaleAction({
        productVariantId: variantId,
        inventoryAccountId: selectedAccountId,
        quantity: qty,
        unitSalePrice: price,
        notes: notes || undefined,
      });

      if (res.success) {
        alert("Offline manual sale processed successfully!");
        handleClose();
      } else {
        setErrorMsg(res.error || "Failed to process sale.");
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-6 z-50 overflow-y-auto">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-slate-950 dark:text-white">
            Log Manual Sale (Offline)
          </h3>
          <button onClick={handleClose}>
            <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
          {errorMsg && (
            <div className="bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400 border border-red-200 dark:border-red-900/40 rounded-lg p-3 font-medium">
              {errorMsg}
            </div>
          )}

          {/* Variant Selector */}
          <div className="flex flex-col space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              LEGO Product Variant
            </label>
            {matchedVariant ? (
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-lg font-bold">
                {matchedVariant.product.setNumber} - {matchedVariant.product.name} ({matchedVariant.condition.replace("_", " ")}) [{matchedVariant.sku}]
              </div>
            ) : (
              <select
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
                required
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">-- Choose Product Variant --</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.product.setNumber} - {v.product.name} ({v.condition.replace("_", " ")}) [{v.sku}]
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Target Account */}
          <div className="flex flex-col space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Deduct Stock From Account
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              required
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
            >
              <option value="">-- Select Source Account --</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.type})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity & Selling Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Quantity Sold
              </label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <div className="flex flex-col space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Selling Price per Unit (€)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.00"
                required
                value={unitSalePrice}
                onChange={(e) => setUnitSalePrice(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Notes / Sale Channel
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors resize-none"
              placeholder="e.g. Sold locally to buyer Y, Catawiki cash sale..."
            />
          </div>

          <div className="flex gap-3 justify-end pt-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Processing..." : "Complete Sale"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
