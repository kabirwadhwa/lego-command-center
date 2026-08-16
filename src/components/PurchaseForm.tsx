"use client";

import { useState, useTransition } from "react";
import { createPurchaseAction, createNewProductAction } from "@/app/actions/inventoryActions";
import { Plus, X } from "lucide-react";

interface PurchaseFormProps {
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

export default function PurchaseForm({ variants, accounts }: PurchaseFormProps) {
  const [isPending, startTransition] = useTransition();
  
  // Intake Form State
  const [supplier, setSupplier] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().substring(0, 10));
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || "");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");

  // New Product Modal State
  const [newProductModalOpen, setNewProductModalOpen] = useState(false);
  const [newSetNumber, setNewSetNumber] = useState("");
  const [newName, setNewName] = useState("");
  const [newTheme, setNewTheme] = useState("");
  const [newEan, setNewEan] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newCondition, setNewCondition] = useState("NEW_SEALED");
  const [newLocation, setNewLocation] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!supplier.trim()) return setFormError("Supplier is required.");
    if (!selectedVariantId) return setFormError("Please select a LEGO product variant.");
    if (!selectedAccountId) return setFormError("Please select an inventory account.");
    
    const qty = parseInt(quantity, 10);
    const cost = parseFloat(unitCost);

    if (isNaN(qty) || qty <= 0) return setFormError("Quantity must be a positive integer.");
    if (isNaN(cost) || cost <= 0) return setFormError("Unit cost must be a positive number.");

    startTransition(async () => {
      const res = await createPurchaseAction({
        supplier,
        purchaseDate: new Date(purchaseDate),
        items: [
          {
            productVariantId: selectedVariantId,
            inventoryAccountId: selectedAccountId,
            quantity: qty,
            unitCost: cost,
          },
        ],
        notes: notes || undefined,
      });

      if (res.success) {
        setFormSuccess("Purchase intake recorded successfully!");
        setSupplier("");
        setQuantity("1");
        setUnitCost("");
        setNotes("");
      } else {
        setFormError(res.error || "Failed to record purchase.");
      }
    });
  };

  const handleCreateNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    
    if (!newSetNumber.trim()) return alert("Set number is required.");
    if (!newName.trim()) return alert("Product name is required.");
    if (!newTheme.trim()) return alert("Theme is required.");
    if (!newSku.trim()) return alert("SKU is required.");

    startTransition(async () => {
      const res = await createNewProductAction({
        setNumber: newSetNumber,
        name: newName,
        theme: newTheme,
        ean: newEan || undefined,
        sku: newSku,
        condition: newCondition,
        storageLocation: newLocation || undefined,
        notes: newNotes || undefined,
      });

      if (res.success && res.data) {
        alert("New product and variant created successfully!");
        setNewProductModalOpen(false);
        // Automatically select the newly created variant
        setSelectedVariantId(res.data.id);
        // Reset modal form
        setNewSetNumber("");
        setNewName("");
        setNewTheme("");
        setNewEan("");
        setNewSku("");
        setNewLocation("");
        setNewNotes("");
      } else {
        alert(res.error || "Failed to create product variant.");
      }
    });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight">
          Log Purchase Intake
        </h2>
        <button
          onClick={() => setNewProductModalOpen(true)}
          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          <span>New LEGO Set</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
        {formError && (
          <div className="bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400 border border-red-200 dark:border-red-900/40 rounded-lg p-3 font-medium">
            {formError}
          </div>
        )}
        {formSuccess && (
          <div className="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40 rounded-lg p-3 font-medium">
            {formSuccess}
          </div>
        )}

        {/* Supplier / Source */}
        <div className="flex flex-col space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Supplier / Source
          </label>
          <input
            type="text"
            required
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
            placeholder="e.g. LEGO Direct, BrickLink seller X"
          />
        </div>

        {/* Purchase Date */}
        <div className="flex flex-col space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Purchase Date
          </label>
          <input
            type="date"
            required
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Product / Variant Select */}
        <div className="flex flex-col space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            LEGO Product Variant
          </label>
          <select
            value={selectedVariantId}
            onChange={(e) => setSelectedVariantId(e.target.value)}
            required
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">-- Select Product Variant --</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.product.setNumber} - {v.product.name} ({v.condition.replace("_", " ")}) [{v.sku}]
              </option>
            ))}
          </select>
        </div>

        {/* Inventory Account */}
        <div className="flex flex-col space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Receiving Inventory Account
          </label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            required
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.type})
              </option>
            ))}
          </select>
        </div>

        {/* Quantity & Unit Cost */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Quantity
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
              Unit Cost (€)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="flex flex-col space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors resize-none"
            placeholder="Invoice reference, item description..."
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs p-3 rounded-lg shadow-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Recording..." : "Confirm Intake"}
        </button>
      </form>

      {/* New Product Modal Overlay */}
      {newProductModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-6 z-50 overflow-y-auto">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                Create New LEGO Set & Variant SKU
              </h3>
              <button onClick={() => setNewProductModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <form onSubmit={handleCreateNewProduct} className="space-y-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {/* Set Number & Name */}
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    LEGO Set #
                  </label>
                  <input
                    type="text"
                    required
                    value={newSetNumber}
                    onChange={(e) => setNewSetNumber(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                    placeholder="e.g. 10316"
                  />
                </div>
                <div className="col-span-2 flex flex-col space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Product Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                    placeholder="e.g. Rivendell"
                  />
                </div>
              </div>

              {/* Theme & EAN */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Theme
                  </label>
                  <input
                    type="text"
                    required
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                    placeholder="e.g. Icons, Star Wars"
                  />
                </div>
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    EAN Barcode (Optional)
                  </label>
                  <input
                    type="text"
                    value={newEan}
                    onChange={(e) => setNewEan(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                    placeholder="Barcode"
                  />
                </div>
              </div>

              {/* SKU & Condition */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Unique SKU
                  </label>
                  <input
                    type="text"
                    required
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                    placeholder="e.g. LGO-10316-NEW"
                  />
                </div>
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Condition
                  </label>
                  <select
                    value={newCondition}
                    onChange={(e) => setNewCondition(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="NEW_SEALED">New Sealed</option>
                    <option value="USED_COMPLETE">Used Complete</option>
                    <option value="DAMAGED_BOX">Damaged Box</option>
                  </select>
                </div>
              </div>

              {/* Storage Location & Notes */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Storage Location (Optional)
                </label>
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                  placeholder="e.g. Shelf A-4"
                />
              </div>

              <div className="flex flex-col space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Notes
                </label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors resize-none"
                  placeholder="Additional catalog details..."
                />
              </div>

              <div className="flex gap-3 justify-end pt-3">
                <button
                  type="button"
                  onClick={() => setNewProductModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm"
                >
                  Create Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
