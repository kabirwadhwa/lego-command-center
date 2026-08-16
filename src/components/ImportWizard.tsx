"use client";

import { useState, useTransition } from "react";
import { bulkImportAction } from "@/app/actions/inventoryActions";
import { Upload, ArrowRight, Check, AlertTriangle, RefreshCw } from "lucide-react";
import Link from "next/link";

interface ParsedImportRow {
  setNumber: string;
  name?: string;
  theme?: string;
  sku?: string;
  ean?: string;
  condition: string;
  quantity: number;
  unitCost: number;
  storageLocation?: string;
}

interface ImportWizardProps {
  accounts: {
    id: string;
    name: string;
    type: string;
  }[];
}

// Inline CSV parser (RFC 4180 compliant)
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"';
          i++; // Skip double quote escape
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (char === "\r" || char === "\n") {
        row.push(cell.trim());
        cell = "";
        if (row.some((c) => c !== "")) {
          lines.push(row);
        }
        row = [];
        if (char === "\r" && nextChar === "\n") {
          i++; // Skip \n after \r
        }
      } else {
        cell += char;
      }
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c !== "")) {
      lines.push(row);
    }
  }

  return lines;
}

export default function ImportWizard({ accounts }: ImportWizardProps) {
  const [isPending, startTransition] = useTransition();

  // Wizard Stages: 1 = Upload, 2 = Mapping, 3 = Preview & Validate, 4 = Complete
  const [stage, setStage] = useState(1);
  const [fileName, setFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || "");

  // Column Mappings (Maps application fields to CSV column indices)
  const [mappings, setMappings] = useState<Record<string, number>>({
    setNumber: -1,
    name: -1,
    theme: -1,
    sku: -1,
    ean: -1,
    condition: -1,
    quantity: -1,
    unitCost: -1,
    storageLocation: -1,
  });

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validRows, setValidRows] = useState<ParsedImportRow[]>([]);
  const [summary, setSummary] = useState<{
    processedCount: number;
    createdProductsCount: number;
    createdVariantsCount: number;
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length > 0) {
        setCsvHeaders(parsed[0]);
        setCsvData(parsed.slice(1));
        
        // Attempt to auto-map columns by header names
        const autoMappings: Record<string, number> = {
          setNumber: -1,
          name: -1,
          theme: -1,
          sku: -1,
          ean: -1,
          condition: -1,
          quantity: -1,
          unitCost: -1,
          storageLocation: -1,
        };

        parsed[0].forEach((header, idx) => {
          const h = header.toLowerCase();
          if (h.includes("set") || h.includes("number") || h === "set_num" || h === "id") {
            autoMappings.setNumber = idx;
          } else if (h.includes("name") || h.includes("title")) {
            autoMappings.name = idx;
          } else if (h.includes("theme") || h.includes("category")) {
            autoMappings.theme = idx;
          } else if (h === "sku" || h.includes("part_number")) {
            autoMappings.sku = idx;
          } else if (h === "ean" || h.includes("barcode") || h.includes("upc")) {
            autoMappings.ean = idx;
          } else if (h.includes("cond") || h.includes("state")) {
            autoMappings.condition = idx;
          } else if (h.includes("qty") || h.includes("quantity") || h.includes("count") || h === "stock") {
            autoMappings.quantity = idx;
          } else if (h.includes("cost") || h.includes("price") || h.includes("buy")) {
            autoMappings.unitCost = idx;
          } else if (h.includes("loc") || h.includes("shelf") || h.includes("storage")) {
            autoMappings.storageLocation = idx;
          }
        });

        setMappings(autoMappings);
        setStage(2);
      }
    };
    reader.readAsText(file);
  };

  const handleMappingChange = (field: string, indexStr: string) => {
    setMappings((prev) => ({
      ...prev,
      [field]: parseInt(indexStr, 10),
    }));
  };

  const runValidation = () => {
    const errors: string[] = [];
    const parsedRows: ParsedImportRow[] = [];
    const skuSet = new Set<string>();

    if (mappings.setNumber === -1) errors.push("Mapping failed: 'Set Number' is required.");
    if (mappings.quantity === -1) errors.push("Mapping failed: 'Quantity' is required.");
    if (mappings.unitCost === -1) errors.push("Mapping failed: 'Unit Cost' is required.");

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    csvData.forEach((row, idx) => {
      const rowNum = idx + 2; // Row offset from CSV headers + 1-indexed index
      
      const setNumber = row[mappings.setNumber];
      const name = mappings.name !== -1 ? row[mappings.name] : undefined;
      const theme = mappings.theme !== -1 ? row[mappings.theme] : undefined;
      const sku = mappings.sku !== -1 ? row[mappings.sku] : undefined;
      const ean = mappings.ean !== -1 ? row[mappings.ean] : undefined;
      const conditionRaw = mappings.condition !== -1 ? row[mappings.condition] : "NEW_SEALED";
      const quantityRaw = row[mappings.quantity];
      const unitCostRaw = row[mappings.unitCost];
      const storageLocation = mappings.storageLocation !== -1 ? row[mappings.storageLocation] : undefined;

      // 1. Mandatory Validations
      if (!setNumber) {
        errors.push(`Row ${rowNum}: Set Number is empty.`);
        return;
      }

      const qty = parseInt(quantityRaw || "", 10);
      if (isNaN(qty) || qty <= 0) {
        errors.push(`Row ${rowNum}: Quantity '${quantityRaw}' is invalid (must be a positive integer).`);
        return;
      }

      const cost = parseFloat(unitCostRaw || "");
      if (isNaN(cost) || cost < 0) {
        errors.push(`Row ${rowNum}: Unit Cost '${unitCostRaw}' is invalid (must be a non-negative number).`);
        return;
      }

      // Format condition string to match enum
      let condition = "NEW_SEALED";
      const condLower = conditionRaw.toLowerCase().replace(/[\s_-]/g, "");
      if (condLower.includes("complete") || condLower.includes("used")) {
        condition = "USED_COMPLETE";
      } else if (condLower.includes("damage") || condLower.includes("box")) {
        condition = "DAMAGED_BOX";
      }

      // 2. Duplicate Detection
      const targetSku = sku || `LGO-${setNumber}-${condition}`;
      if (skuSet.has(targetSku)) {
        errors.push(`Row ${rowNum}: Duplicate SKU found in sheet: '${targetSku}'.`);
        return;
      }
      skuSet.add(targetSku);

      parsedRows.push({
        setNumber,
        name: name || undefined,
        theme: theme || undefined,
        sku: sku || undefined,
        ean: ean || undefined,
        condition,
        quantity: qty,
        unitCost: cost,
        storageLocation: storageLocation || undefined,
      });
    });

    setValidationErrors(errors);
    setValidRows(parsedRows);
    setStage(3);
  };

  const handleImportCommit = () => {
    if (validRows.length === 0) return;

    startTransition(async () => {
      const res = await bulkImportAction({
        inventoryAccountId: selectedAccountId,
        rows: validRows,
      });

      if (res.success && res.data) {
        setSummary(res.data);
        setStage(4);
      } else {
        alert(res.error || "Failed to commit import.");
      }
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto font-sans">
      {/* Wizard Step Headers */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-5 select-none">
        {[
          { step: 1, label: "Upload CSV" },
          { step: 2, label: "Map Columns" },
          { step: 3, label: "Preview & Validate" },
          { step: 4, label: "Complete" },
        ].map((s) => (
          <div key={s.step} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
              stage >= s.step
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-400 dark:bg-slate-900"
            }`}>
              {stage > s.step ? <Check className="w-3.5 h-3.5" /> : s.step}
            </div>
            <span className={`text-xs font-bold ${
              stage >= s.step ? "text-slate-900 dark:text-slate-100" : "text-slate-400"
            }`}>
              {s.label}
            </span>
            {s.step < 4 && <ArrowRight className="w-3 h-3 text-slate-350" />}
          </div>
        ))}
      </div>

      {/* STAGE 1: Upload */}
      {stage === 1 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col items-center justify-center py-16 text-center space-y-6">
          <div className="w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-900/10 text-blue-600 flex items-center justify-center">
            <Upload className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-950 dark:text-white">
              Upload your inventory CSV file
            </h3>
            <p className="text-slate-400 text-xs mt-1.5 font-medium max-w-sm">
              We support standard comma-separated text files. You can map columns to application fields in the next step.
            </p>
          </div>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-5 py-2.5 rounded-lg shadow-sm transition-colors">
            <span>Browse CSV File</span>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>
      )}

      {/* STAGE 2: Mapping */}
      {stage === 2 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-950 dark:text-white">
              Map CSV columns to database fields
            </h3>
            <p className="text-slate-400 text-xs mt-1.5 font-medium">
              We parsed {csvHeaders.length} headers in &ldquo;{fileName}&rdquo;. Specify which header aligns with each field.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {/* Account Target */}
            <div className="flex flex-col space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Target Inventory Account
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Field Mappings selectors */}
            {[
              { field: "setNumber", label: "LEGO Set Number", required: true },
              { field: "quantity", label: "Quantity In Stock", required: true },
              { field: "unitCost", label: "Unit Cost Basis (€)", required: true },
              { field: "name", label: "Product Name", required: false },
              { field: "theme", label: "Theme / Category", required: false },
              { field: "sku", label: "SKU (Auto-generates if blank)", required: false },
              { field: "ean", label: "EAN / Barcode", required: false },
              { field: "condition", label: "Condition", required: false },
              { field: "storageLocation", label: "Storage Location", required: false },
            ].map((f) => (
              <div key={f.field} className="flex flex-col space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {f.label} {f.required && <span className="text-red-500 font-black">*</span>}
                </label>
                <select
                  value={mappings[f.field]}
                  onChange={(e) => handleMappingChange(f.field, e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-950 dark:text-white rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors"
                >
                  <option value="-1">-- Unmapped --</option>
                  {csvHeaders.map((header, index) => (
                    <option key={index} value={index}>
                      {header} (Column {index + 1})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setStage(1)}
              className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-bold"
            >
              Back
            </button>
            <button
              onClick={runValidation}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm text-xs font-bold"
            >
              Continue to Preview
            </button>
          </div>
        </div>
      )}

      {/* STAGE 3: Preview & Validate */}
      {stage === 3 && (
        <div className="space-y-6">
          {/* Validation Warnings Panel */}
          {validationErrors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h4 className="text-xs font-black uppercase tracking-wider">
                  Ingestion Warnings & Validation Errors ({validationErrors.length})
                </h4>
              </div>
              <p className="text-[11px] text-amber-600 dark:text-amber-500 font-medium">
                The following rows contain validation issues and will be **ignored/skipped** during committing:
              </p>
              <div className="max-h-40 overflow-y-auto divide-y divide-amber-100/50 dark:divide-amber-900/10 text-[10px] font-semibold text-amber-800 dark:text-amber-400 space-y-1 pt-2">
                {validationErrors.map((err, idx) => (
                  <div key={idx} className="py-1">
                    • {err}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Valid rows preview table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                Valid Records Preview
              </h3>
              <p className="text-slate-400 text-xs mt-1.5 font-medium">
                Review these {validRows.length} valid rows from &ldquo;{fileName}&rdquo; before committing.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-100 dark:border-slate-850 rounded-lg">
              <table className="w-full text-left border-collapse text-[11px] font-semibold">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-widest select-none">
                    <th className="py-3 px-4">Set #</th>
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Condition</th>
                    <th className="py-3 px-4 text-center">Qty</th>
                    <th className="py-3 px-4 text-right">Unit Cost</th>
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-4">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-350">
                  {validRows.slice(0, 10).map((row, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 px-4 font-bold text-slate-950 dark:text-white">{row.setNumber}</td>
                      <td className="py-2.5 px-4 truncate max-w-[150px]">{row.name || `LEGO ${row.setNumber}`}</td>
                      <td className="py-2.5 px-4">{row.condition}</td>
                      <td className="py-2.5 px-4 text-center font-bold">{row.quantity}</td>
                      <td className="py-2.5 px-4 text-right">{new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(row.unitCost)}</td>
                      <td className="py-2.5 px-4 font-mono">{row.sku || `LGO-${row.setNumber}-${row.condition}`}</td>
                      <td className="py-2.5 px-4 text-slate-450">{row.storageLocation || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validRows.length > 10 && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900/30 text-center text-[10px] font-medium text-slate-400 border-t border-slate-100 dark:border-slate-800 select-none">
                  Showing first 10 rows. {validRows.length - 10} additional rows will be imported.
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider select-none">
                Target: {accounts.find(a => a.id === selectedAccountId)?.name}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setStage(2)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-bold"
                >
                  Back
                </button>
                <button
                  onClick={handleImportCommit}
                  disabled={isPending || validRows.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isPending ? "Importing..." : `Commit ${validRows.length} Rows`}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STAGE 4: Complete */}
      {stage === 4 && summary && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col items-center justify-center py-16 text-center space-y-6">
          <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 flex items-center justify-center">
            <Check className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-bold text-slate-950 dark:text-white">
              Inventory Data Imported Successfully!
            </h3>
            <p className="text-slate-400 text-xs font-medium max-w-sm mx-auto leading-relaxed">
              We successfully ran transaction commits and logged entries inside the ledger.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-6 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl p-5 w-full max-w-md text-xs font-semibold text-slate-700 dark:text-slate-350">
            <div>
              <span className="text-[10px] font-bold text-slate-450 uppercase block select-none">Total Rows</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white mt-1 block">{summary.processedCount}</strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-450 uppercase block select-none">New Products</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white mt-1 block">{summary.createdProductsCount}</strong>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-450 uppercase block select-none">New SKUs</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white mt-1 block">{summary.createdVariantsCount}</strong>
            </div>
          </div>

          <div className="flex gap-4">
            <Link
              href="/inventory"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm text-xs font-bold"
            >
              View Catalog
            </Link>
            <button
              onClick={() => {
                setStage(1);
                setFileName("");
                setCsvHeaders([]);
                setCsvData([]);
                setValidationErrors([]);
                setValidRows([]);
                setSummary(null);
              }}
              className="px-5 py-2.5 border border-slate-250 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-850 rounded-lg text-xs font-bold"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
