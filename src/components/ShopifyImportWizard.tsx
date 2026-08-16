"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MarketplaceListing } from "@/services/marketplace/types";
import { commitShopifyImportAction } from "@/app/actions/marketplaceActions";

interface ExistingProduct {
  id: string;
  setNumber: string;
  name: string;
  variants: {
    id: string;
    sku: string;
    condition: string;
  }[];
}

interface ShopifyImportWizardProps {
  listings: MarketplaceListing[];
  existingProducts: ExistingProduct[];
  companyAccounts: { id: string; name: string }[];
}

interface MatchRecord {
  sku: string;
  title: string;
  price: number;
  quantity: number;
  matchedSetNumber: string;
  condition: string;
  status: "MATCHED" | "NEW_VARIANT" | "NEW_PRODUCT";
  selected: boolean;
}

export default function ShopifyImportWizard({
  listings,
  existingProducts,
  companyAccounts,
}: ShopifyImportWizardProps) {
  const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState(companyAccounts[0]?.id || "");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    data?: { createdProducts: number; createdVariants: number; stockImported: number };
    error?: string;
  } | null>(null);

  // Perform initial auto-matching
  const [records, setRecords] = useState<MatchRecord[]>(() => {
    return listings.map(l => {
      // Find matching variant by SKU
      let matchedSet = "";
      let status: "MATCHED" | "NEW_VARIANT" | "NEW_PRODUCT" = "NEW_PRODUCT";
      let condition = "NEW_SEALED";

      // 1. Try exact SKU match
      const exactVariant = existingProducts
        .flatMap(p => p.variants.map(v => ({ ...v, setNumber: p.setNumber })))
        .find(v => v.sku.toLowerCase() === l.sku.toLowerCase());

      if (exactVariant) {
        matchedSet = exactVariant.setNumber;
        condition = exactVariant.condition;
        status = "MATCHED";
      } else {
        // 2. Try set number extraction from title or SKU
        // e.g. LGO-10330-NEW -> 10330, or "LEGO 10330 Concorde" -> 10330
        const match = l.sku.match(/\d{4,6}/) || l.title.match(/\b\d{4,6}\b/);
        if (match) {
          const setNum = match[0];
          const exists = existingProducts.some(p => p.setNumber === setNum);
          matchedSet = setNum;
          status = exists ? "NEW_VARIANT" : "NEW_PRODUCT";
        }
      }

      return {
        sku: l.sku,
        title: l.title,
        price: l.price,
        quantity: l.quantity,
        matchedSetNumber: matchedSet,
        condition,
        status,
        selected: true,
      };
    });
  });

  const handleRecordChange = (index: number, key: keyof MatchRecord, value: string | number | boolean) => {
    setRecords(prev => prev.map((rec, i) => {
      if (i === index) {
        const updated = { ...rec, [key]: value };
        // Recalculate status based on new set number
        if (key === "matchedSetNumber") {
          const exists = existingProducts.some(p => p.setNumber === value);
          const exactVariant = existingProducts
            .flatMap(p => p.variants.map(v => ({ ...v, setNumber: p.setNumber })))
            .find(v => v.sku.toLowerCase() === rec.sku.toLowerCase());

          if (exactVariant && exactVariant.setNumber === value) {
            updated.status = "MATCHED";
          } else {
            updated.status = exists ? "NEW_VARIANT" : "NEW_PRODUCT";
          }
        }
        return updated;
      }
      return rec;
    }));
  };

  const handleSelectAll = (val: boolean) => {
    setRecords(prev => prev.map(rec => ({ ...rec, selected: val })));
  };

  const handleImport = async () => {
    const itemsToImport = records.filter(r => r.selected);
    if (itemsToImport.length === 0) {
      alert("Please select at least one listing to import.");
      return;
    }

    // Validation
    const invalidItems = itemsToImport.filter(r => !r.matchedSetNumber);
    if (invalidItems.length > 0) {
      alert("All selected items must have a matched LEGO Set Number.");
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const res = await commitShopifyImportAction({
        inventoryAccountId: selectedAccountId,
        items: itemsToImport.map(r => ({
          sku: r.sku,
          setNumber: r.matchedSetNumber,
          title: r.title,
          price: r.price,
          quantity: r.quantity,
          condition: r.condition,
        })),
      });

      if (res.success) {
        setImportResult({ success: true, data: res.data });
      } else {
        setImportResult({ success: false, error: res.error });
      }
    } catch {
      setImportResult({ success: false, error: "Onboarding import execution failed." });
    } finally {
      setImporting(false);
    }
  };

  // Summary Metrics
  const selectedRecords = records.filter(r => r.selected);
  const newProductsCount = Array.from(new Set(selectedRecords.filter(r => r.status === "NEW_PRODUCT").map(r => r.matchedSetNumber))).length;
  const newVariantsCount = selectedRecords.filter(r => r.status === "NEW_VARIANT" || r.status === "NEW_PRODUCT").length;
  const totalStockCount = selectedRecords.reduce((sum, r) => sum + r.quantity, 0);

  if (importResult?.success) {
    return (
      <div className="max-w-2xl mx-auto bg-slate-800 border border-slate-700 p-8 rounded-xl shadow-lg space-y-6">
        <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/35 text-emerald-400 rounded-full flex items-center justify-center font-bold text-xl mx-auto">
          ✓
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-bold text-white">Import Completed Successfully!</h2>
          <p className="text-slate-400 text-xs font-medium">
            Shopify products and inventory ledger records have been provisioned in the central database.
          </p>
        </div>

        <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-700 grid grid-cols-3 gap-4 text-center">
          <div>
            <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">Products Created</span>
            <span className="text-white text-lg font-bold block mt-1">{importResult.data?.createdProducts}</span>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">Variants Created</span>
            <span className="text-white text-lg font-bold block mt-1">{importResult.data?.createdVariants}</span>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] block font-bold uppercase tracking-wider">Stock Units Imported</span>
            <span className="text-white text-lg font-bold block mt-1">{importResult.data?.stockImported}</span>
          </div>
        </div>

        <button
          onClick={() => {
            router.push("/inventory");
            router.refresh();
          }}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-lg transition-colors"
        >
          Go to Inventory
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Listings Table */}
      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg flex flex-col">
        <div className="px-6 py-4 border-b border-slate-700 bg-slate-900/60 flex items-center justify-between">
          <h3 className="font-bold text-sm text-white">Shopify Listings Preview</h3>
          <div className="flex gap-2">
            <button
              onClick={() => handleSelectAll(true)}
              className="text-[10px] text-blue-400 hover:text-blue-300 font-bold"
            >
              Select All
            </button>
            <span className="text-slate-650">|</span>
            <button
              onClick={() => handleSelectAll(false)}
              className="text-[10px] text-blue-400 hover:text-blue-300 font-bold"
            >
              Deselect All
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700 text-[10px] font-bold text-slate-400 uppercase bg-slate-900/30">
                <th className="py-3 px-4 w-12">Import</th>
                <th className="py-3 px-4">Shopify Item</th>
                <th className="py-3 px-4 w-40">LEGO Set Number</th>
                <th className="py-3 px-4 w-32">Condition</th>
                <th className="py-3 px-4 text-right w-24">Price</th>
                <th className="py-3 px-4 text-center w-24">Stock</th>
                <th className="py-3 px-4 w-28 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-750 text-xs font-semibold">
              {records.map((rec, i) => (
                <tr key={i} className="hover:bg-slate-750/30">
                  <td className="py-3.5 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={rec.selected}
                      onChange={e => handleRecordChange(i, "selected", e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="text-slate-100 font-bold truncate max-w-xs">{rec.title}</div>
                    <div className="text-slate-400 font-medium text-[10px] mt-0.5">{rec.sku}</div>
                  </td>
                  <td className="py-3.5 px-4">
                    <input
                      type="text"
                      placeholder="e.g. 10330"
                      value={rec.matchedSetNumber}
                      onChange={e => handleRecordChange(i, "matchedSetNumber", e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded px-2.5 py-1 text-xs outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="py-3.5 px-4">
                    <select
                      value={rec.condition}
                      onChange={e => handleRecordChange(i, "condition", e.target.value)}
                      className="bg-slate-900 border border-slate-700 text-white text-xs rounded px-2.5 py-1 outline-none"
                    >
                      <option value="NEW_SEALED">New Sealed</option>
                      <option value="USED_COMPLETE">Used Complete</option>
                      <option value="DAMAGED_BOX">Damaged Box</option>
                    </select>
                  </td>
                  <td className="py-3.5 px-4 text-right text-slate-100">
                    €{rec.price.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-4 text-center text-slate-100">
                    {rec.quantity}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                      rec.status === "MATCHED"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : rec.status === "NEW_VARIANT"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-amber-500/10 text-amber-400"
                    }`}>
                      {rec.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Control Sidebar */}
      <div className="w-full lg:w-80 bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-lg h-fit space-y-6">
        <h3 className="font-bold text-sm text-white">Import Configuration</h3>

        {/* Target inventory account */}
        <div className="space-y-1.5">
          <label className="text-slate-400 text-xs font-semibold block">Target Inventory Account</label>
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none"
          >
            {companyAccounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.name} (COMPANY)
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-400 font-medium">
            * Selected stock will map exclusively to Company Assets. Personal Stock (Stock X) remains isolated and untouched.
          </p>
        </div>

        {/* Metrics summary */}
        <div className="space-y-2 border-t border-slate-700 pt-4 text-xs font-semibold">
          <div className="flex justify-between">
            <span className="text-slate-400">Total Selected Listings</span>
            <span className="text-white">{selectedRecords.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">New Products to Create</span>
            <span className="text-white">{newProductsCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">New Variants to Create</span>
            <span className="text-white">{newVariantsCount}</span>
          </div>
          <div className="flex justify-between border-t border-slate-750 pt-2 text-sm">
            <span className="text-slate-400 font-bold">Total Quantity</span>
            <span className="text-white font-bold">{totalStockCount} units</span>
          </div>
        </div>

        {importResult?.error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs font-bold">
            Import Failed: {importResult.error}
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={importing || selectedRecords.length === 0}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors shadow-md shadow-blue-500/10 flex items-center justify-center gap-1.5"
        >
          {importing ? "Importing..." : "Confirm & Import Stock"}
        </button>
      </div>
    </div>
  );
}
