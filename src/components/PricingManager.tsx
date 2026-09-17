"use client";

import { useState, useEffect } from "react";
import {
  acceptPriceRecommendationAction,
  runPricingEngineAction,
  refreshMarketPricesAction,
  researchLegoSetAction,
  getRecentResearchAction,
  addResearchedSetToInventoryAction,
  addManualLegoStockAction,
} from "@/app/actions/marketplaceActions";
import { ProductCondition } from "@prisma/client";
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
  confidenceScore?: number | null;
  confidenceTier?: string | null;
  observationCount?: number | null;
  marketMedian?: number | null;
  marketMin?: number | null;
  marketMax?: number | null;
  evidenceUpdatedAt?: Date | null;
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

export interface RecentResearchItem {
  id: string;
  setNumber: string;
  productName: string;
  theme?: string | null;
  imageUrl?: string | null;
  recommendedPrice?: number | null;
  marketMedian?: number | null;
  observationCount: number;
  confidenceScore?: number | null;
  confidenceTier: string;
  targetChannel?: string | null;
  status: string;
  researchedAt: Date | string;
}

interface ResearchObservationUI {
  id: string;
  source: string;
  marketplace: string;
  price: number;
  currency: string;
  priceType: string;
  condition?: string | null;
  capturedAt: Date | string;
  provenance: string;
  seller?: string | null;
  externalUrl?: string | null;
  availability?: boolean;
}

interface PurchaseScenarioUI {
  hypotheticalCost: number;
  targetChannel: string;
  estimatedSellingPrice: number;
  estimatedFees: number;
  estimatedShipping: number;
  estimatedNetProceeds: number;
  potentialProfit: number;
  potentialMargin: number;
  breakevenPrice: number | null;
  potentialRoi: number;
}

interface ResearchResultUI {
  productId?: string;
  setNumber: string;
  productName: string;
  theme?: string | null;
  imageUrl?: string | null;
  ean?: string | null;
  metadataAvailable: boolean;
  observationCount: number;
  soldObservationCount: number;
  askingObservationCount: number;
  currentBidObservationCount: number;
  medianPrice: number | null;
  meanPrice: number | null;
  minimumObservedPrice: number | null;
  maximumObservedPrice: number | null;
  confidenceScore: number | null;
  confidenceTier: string;
  recommendedMarketPrice: number | null;
  currency: string;
  latestObservationAt: Date | string | null;
  sources: string[];
  observations: ResearchObservationUI[];
  status: "SUCCESS" | "INSUFFICIENT_DATA" | "NO_DATA" | "EXTERNAL_SOURCE_FAILURE";
  targetChannel: string;
  purchaseScenario?: PurchaseScenarioUI | null;
  isStale?: boolean;
  researchTimestamp: Date | string;
  message?: string;
}

interface PricingManagerProps {
  initialRecommendations: RecommendationCard[];
  initialRecentResearches?: RecentResearchItem[];
  userRole: string;
}

const CHANNELS = [
  { id: "CATAWIKI", name: "Catawiki Auctions", hasLiveScraper: true, notes: "12.5% fee · Buyer pays shipping" },
  { id: "SHOPIFY", name: "Shopify Store", hasLiveScraper: false, notes: "2.9% + €0.30 payment fee · Customer shipping" },
  { id: "BOL", name: "Bol.com Plaza", hasLiveScraper: false, notes: "15% fee + €6.50 postage" },
  { id: "EBAY", name: "eBay", hasLiveScraper: false, notes: "13.25% + €0.35 fee + €6.50 postage" },
  { id: "BRICKLINK", name: "BrickLink Store", hasLiveScraper: false, notes: "3% + 2.9% + €0.30 fee" },
];

export default function PricingManager({
  initialRecommendations,
  initialRecentResearches = [],
  userRole,
}: PricingManagerProps) {
  const [recommendations, setRecommendations] = useState<RecommendationCard[]>(initialRecommendations);
  const [recentResearches, setRecentResearches] = useState<RecentResearchItem[]>(initialRecentResearches);
  const [actingId, setActingId] = useState<string | null>(null);
  const [isSweeping, setIsSweeping] = useState(false);
  const [refreshingSet, setRefreshingSet] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Research form state
  const [researchSetNumber, setResearchSetNumber] = useState("");
  const [hypotheticalCost, setHypotheticalCost] = useState("");
  const [targetChannel, setTargetChannel] = useState("CATAWIKI");
  const [isResearching, setIsResearching] = useState(false);
  const [researchStatusText, setResearchStatusText] = useState("");
  const [activeResearch, setActiveResearch] = useState<ResearchResultUI | null>(null);

  // Add to Inventory Modal (post-research)
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSku, setAddSku] = useState("");
  const [addCondition, setAddCondition] = useState<ProductCondition>(ProductCondition.NEW_SEALED);
  const [addQuantity, setAddQuantity] = useState("1");
  const [addUnitCost, setAddUnitCost] = useState("");
  const [addLocation, setAddLocation] = useState("");
  const [addSupplier, setAddSupplier] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);

  // Direct Manual Stock Modal (+ Add LEGO / Stock)
  const [showDirectStockModal, setShowDirectStockModal] = useState(false);
  const [directSetNumber, setDirectSetNumber] = useState("");
  const [directSku, setDirectSku] = useState("");
  const [directCondition, setDirectCondition] = useState<ProductCondition>(ProductCondition.NEW_SEALED);
  const [directQuantity, setDirectQuantity] = useState("1");
  const [directUnitCost, setDirectUnitCost] = useState("");
  const [directProductName, setDirectProductName] = useState("");
  const [directTheme, setDirectTheme] = useState("");
  const [directLocation, setDirectLocation] = useState("");
  const [directSupplier, setDirectSupplier] = useState("");
  const [directNotes, setDirectNotes] = useState("");
  const [isSubmittingDirect, setIsSubmittingDirect] = useState(false);

  const canEdit = userRole === "ADMIN" || userRole === "FAMILY_SELLER";

  // Load recent research on mount if empty
  useEffect(() => {
    if (recentResearches.length === 0) {
      getRecentResearchAction(6).then((res) => {
        if (res.success && res.data) {
          setRecentResearches(res.data as RecentResearchItem[]);
        }
      });
    }
  }, [recentResearches.length]);

  const fmt = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "N/A";
    return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(val);
  };

  const fmtPct = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "N/A";
    return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  };

  // 1. Research Handler
  const handleResearch = async (forcedSet?: string, forceRefresh: boolean = false) => {
    const setToQuery = forcedSet || researchSetNumber;
    if (!setToQuery || !setToQuery.trim()) {
      setErrorMsg("Please enter a LEGO Set Number (e.g. 10316).");
      return;
    }

    setIsResearching(true);
    setResearchStatusText("Researching LEGO set...");
    setErrorMsg(null);
    setSuccessMsg(null);

    const costNum = hypotheticalCost && !isNaN(parseFloat(hypotheticalCost))
      ? parseFloat(hypotheticalCost)
      : null;

    try {
      setTimeout(() => setResearchStatusText("Fetching live market evidence from Catawiki..."), 400);
      setTimeout(() => setResearchStatusText("Analyzing price distributions & fees..."), 900);

      const res = await researchLegoSetAction({
        setNumber: setToQuery.trim(),
        hypotheticalCost: costNum,
        targetChannel,
        forceRefresh,
      });

      if (res.success && res.data) {
        setActiveResearch(res.data as ResearchResultUI);
        setResearchSetNumber(setToQuery.trim());
        // Refresh recent list
        getRecentResearchAction(6).then((r) => {
          if (r.success && r.data) setRecentResearches(r.data as RecentResearchItem[]);
        });
      } else {
        setErrorMsg(res.error || "Failed to complete market research.");
      }
    } catch {
      setErrorMsg("Market research encounter unexpected error.");
    } finally {
      setIsResearching(false);
      setResearchStatusText("");
    }
  };

  // 2. Open Add to Inventory Modal
  const openAddToInventory = () => {
    if (!activeResearch) return;
    setAddSku(`LGO-${activeResearch.setNumber}-NEW`);
    setAddCondition(ProductCondition.NEW_SEALED);
    setAddQuantity("1");
    setAddUnitCost(hypotheticalCost || "");
    setAddLocation("");
    setAddSupplier("");
    setAddNotes("");
    setShowAddModal(true);
  };

  // 3. Submit Add to Inventory
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeResearch) return;
    if (!canEdit) {
      setErrorMsg("Unauthorized: Only Admins and Family Sellers can add inventory.");
      return;
    }

    const qty = parseInt(addQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg("Please provide a valid positive quantity.");
      return;
    }
    if (!addSku.trim()) {
      setErrorMsg("SKU is required.");
      return;
    }

    setIsSubmittingAdd(true);
    setErrorMsg(null);

    try {
      const cost = addUnitCost && !isNaN(parseFloat(addUnitCost)) ? parseFloat(addUnitCost) : null;
      const res = await addResearchedSetToInventoryAction({
        setNumber: activeResearch.setNumber,
        sku: addSku.trim(),
        condition: addCondition,
        quantity: qty,
        unitCost: cost,
        storageLocation: addLocation.trim() || undefined,
        supplier: addSupplier.trim() || undefined,
        notes: addNotes.trim() || undefined,
        productName: activeResearch.productName,
        theme: activeResearch.theme || undefined,
      });

      if (res.success) {
        setSuccessMsg(`Successfully added ${qty} units of ${addSku.trim()} to inventory ledger!`);
        setShowAddModal(false);
      } else {
        setErrorMsg(res.error || "Failed to add inventory.");
      }
    } catch {
      setErrorMsg("Failed to add inventory.");
    } finally {
      setIsSubmittingAdd(false);
    }
  };

  // 4. Submit Direct Manual Stock Intake
  const handleDirectStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      setErrorMsg("Unauthorized: Only Admins and Family Sellers can add inventory.");
      return;
    }

    const qty = parseInt(directQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg("Please provide a valid positive quantity.");
      return;
    }
    if (!directSetNumber.trim()) {
      setErrorMsg("LEGO Set Number is required.");
      return;
    }
    if (!directSku.trim()) {
      setErrorMsg("SKU is required.");
      return;
    }

    setIsSubmittingDirect(true);
    setErrorMsg(null);

    try {
      const cost = directUnitCost && !isNaN(parseFloat(directUnitCost)) ? parseFloat(directUnitCost) : null;
      const res = await addManualLegoStockAction({
        setNumber: directSetNumber.trim(),
        sku: directSku.trim(),
        condition: directCondition,
        quantity: qty,
        unitCost: cost,
        productName: directProductName.trim() || undefined,
        theme: directTheme.trim() || undefined,
        storageLocation: directLocation.trim() || undefined,
        supplier: directSupplier.trim() || undefined,
        notes: directNotes.trim() || undefined,
      });

      if (res.success && res.data) {
        setSuccessMsg(`Stock intake recorded for SKU ${directSku.trim()}! Market research and pricing analysis updated.`);
        setShowDirectStockModal(false);
        if (res.data.research) {
          setActiveResearch(res.data.research as ResearchResultUI);
          setResearchSetNumber(directSetNumber.trim());
        }
      } else {
        setErrorMsg(res.error || "Failed to record manual stock.");
      }
    } catch {
      setErrorMsg("Failed to record manual stock.");
    } finally {
      setIsSubmittingDirect(false);
    }
  };

  // 5. Existing Recommendation Accept
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

  // 6. Run Full Pricing Sweep
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
        const count = res.data && "processed" in res.data ? res.data.processed : 1;
        setSuccessMsg(`Pricing sweep complete: evaluated ${count} inventory sets.`);
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

  // 7. Refresh Market Prices for Specific Set
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

  const selectedChannelInfo = CHANNELS.find(c => c.id === targetChannel) || CHANNELS[0];

  return (
    <div className="space-y-8">
      {/* ========================================================================= */}
      {/* 1. RESEARCH A LEGO SET HEADER & INPUT BAR                                */}
      {/* ========================================================================= */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>🔍</span> Research a LEGO Set
            </h2>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Analyze live market pricing, auction spreads, and fees for <strong className="text-slate-300">ANY</strong> LEGO set before purchasing or listing. Does not create inventory.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowDirectStockModal(true)}
            disabled={!canEdit}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold rounded-lg transition-all shadow cursor-pointer"
          >
            <span>➕</span>
            <span>+ Add LEGO / Stock</span>
          </button>
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleResearch();
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end"
        >
          {/* Input: Set Number */}
          <div className="space-y-1.5">
            <label htmlFor="setNumber" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              LEGO Set Number <span className="text-rose-400">*</span>
            </label>
            <input
              id="setNumber"
              type="text"
              placeholder="e.g. 10316"
              value={researchSetNumber}
              onChange={(e) => setResearchSetNumber(e.target.value)}
              className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors"
            />
          </div>

          {/* Input: Optional Hypothetical Cost */}
          <div className="space-y-1.5">
            <label htmlFor="hypoCost" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              My Cost / Potential Purchase Cost
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-slate-500 text-sm font-semibold">€</span>
              <input
                id="hypoCost"
                type="number"
                step="0.01"
                min="0"
                placeholder="Optional (e.g. 240.00)"
                value={hypotheticalCost}
                onChange={(e) => setHypotheticalCost(e.target.value)}
                className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg pl-8 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors"
              />
            </div>
          </div>

          {/* Dropdown: Target Channel */}
          <div className="space-y-1.5">
            <label htmlFor="targetChannel" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Target Selling Channel
            </label>
            <select
              id="targetChannel"
              value={targetChannel}
              onChange={(e) => setTargetChannel(e.target.value)}
              className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3.5 py-2.5 text-sm text-white outline-none transition-colors"
            >
              {CHANNELS.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name} ({ch.hasLiveScraper ? "Live Scraper" : "Pricing Economics"})
                </option>
              ))}
            </select>
          </div>

          {/* Primary CTA */}
          <div>
            <button
              type="submit"
              disabled={isResearching}
              className="w-full h-[42px] flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-lg transition-all cursor-pointer"
            >
              <span>{isResearching ? "⏳" : "🔍"}</span>
              <span>{isResearching ? "Researching..." : "Research Price"}</span>
            </button>
          </div>
        </form>

        {/* Integration distinction notice */}
        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Selected Channel:</span>
            <span className="text-blue-400 font-bold">{selectedChannelInfo.name}</span>
            <span className="text-slate-500">·</span>
            <span>{selectedChannelInfo.notes}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Evidence source:</span>
            {selectedChannelInfo.hasLiveScraper ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                LIVE_SCRAPE (Catawiki)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                Fee Economics Model (Scraper Roadmap)
              </span>
            )}
          </div>
        </div>

        {/* Loading state indicator */}
        {isResearching && (
          <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-xs font-medium animate-pulse">
            <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span>{researchStatusText || "Researching LEGO set..."}</span>
          </div>
        )}
      </section>

      {/* Global Alerts / Messages */}
      {successMsg && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. RECENT RESEARCH CHIPS / HISTORY                                       */}
      {/* ========================================================================= */}
      {recentResearches.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recent Research</span>
            <span className="text-[10px] text-slate-500 font-medium">Cached within 6h</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {recentResearches.map((rec) => (
              <button
                key={rec.id}
                type="button"
                onClick={() => {
                  setResearchSetNumber(rec.setNumber);
                  handleResearch(rec.setNumber, false);
                }}
                className="bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 p-3 rounded-xl text-left transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white group-hover:text-blue-400 font-mono">
                    #{rec.setNumber}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                    rec.confidenceTier === "HIGH"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : rec.confidenceTier === "MEDIUM"
                      ? "bg-blue-500/10 text-blue-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {rec.confidenceTier}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 font-medium truncate mt-1">
                  {rec.productName}
                </div>
                <div className="text-xs font-bold text-slate-100 mt-1">
                  {rec.recommendedPrice ? fmt(rec.recommendedPrice) : fmt(rec.marketMedian)}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">
                  {rec.observationCount} observations
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 3. ACTIVE RESEARCH RESULT CARD                                           */}
      {/* ========================================================================= */}
      {activeResearch && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-6 p-6">
          {/* Header Row */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-4">
              {activeResearch.imageUrl ? (
                <div className="w-16 h-16 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={activeResearch.imageUrl} alt={activeResearch.productName} className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0 text-2xl">
                  🧱
                </div>
              )}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-950 text-blue-400 border border-blue-500/30">
                    Set {activeResearch.setNumber}
                  </span>
                  {activeResearch.theme && (
                    <span className="text-xs text-slate-400 font-medium">
                      {activeResearch.theme}
                    </span>
                  )}
                  {/* Data Freshness Indicator */}
                  {activeResearch.isStale ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      Market data may be stale (&gt;6h)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      Fresh (&lt;6h)
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-white">
                  {activeResearch.productName}
                </h3>
                <div className="text-xs text-slate-400">
                  Researched on {new Date(activeResearch.researchTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Target Channel: <strong className="text-slate-200">{activeResearch.targetChannel}</strong>
                </div>
              </div>
            </div>

            {/* Actions for Researched Set */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => handleResearch(activeResearch.setNumber, true)}
                disabled={isResearching || !canEdit}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-750 disabled:opacity-50 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-all cursor-pointer"
              >
                🔄 Refresh Market Data
              </button>
              <button
                type="button"
                onClick={openAddToInventory}
                disabled={!canEdit}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-lg transition-all cursor-pointer"
              >
                ➕ Add to Inventory
              </button>
            </div>
          </div>

          {/* Pricing Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Recommended Price</span>
              <span className="text-base font-extrabold text-emerald-400 block mt-1">
                {fmt(activeResearch.recommendedMarketPrice)}
              </span>
            </div>
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Market Median</span>
              <span className="text-base font-extrabold text-white block mt-1">
                {fmt(activeResearch.medianPrice)}
              </span>
            </div>
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Observed Range</span>
              <span className="text-xs font-bold text-slate-300 block mt-1.5">
                {activeResearch.minimumObservedPrice ? `${fmt(activeResearch.minimumObservedPrice)} – ${fmt(activeResearch.maximumObservedPrice)}` : "N/A"}
              </span>
            </div>
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Confidence</span>
              <span className="text-sm font-bold text-blue-400 block mt-1">
                {activeResearch.confidenceScore !== null ? `${activeResearch.confidenceScore}% (${activeResearch.confidenceTier})` : "Unknown"}
              </span>
            </div>
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Evidence Count</span>
              <span className="text-sm font-bold text-white block mt-1">
                {activeResearch.observationCount} genuine
              </span>
              <span className="text-[9px] text-slate-500 block">
                {activeResearch.soldObservationCount} sold · {activeResearch.askingObservationCount + activeResearch.currentBidObservationCount} active
              </span>
            </div>
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Last Live Signal</span>
              <span className="text-xs font-bold text-slate-300 block mt-1.5">
                {activeResearch.latestObservationAt
                  ? new Date(activeResearch.latestObservationAt).toLocaleDateString([], { month: "short", day: "numeric" })
                  : "None"}
              </span>
            </div>
          </div>

          {/* Purchase Scenario Section */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>💼</span> Purchase Scenario Analysis
              </h4>
              <span className="text-[10px] text-slate-500">Configured fee assumptions for {activeResearch.targetChannel}</span>
            </div>

            {activeResearch.purchaseScenario ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-center pt-2">
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Hypothetical Cost</span>
                  <span className="text-xs font-bold text-slate-200 block mt-0.5">{fmt(activeResearch.purchaseScenario.hypotheticalCost)}</span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Selling Price</span>
                  <span className="text-xs font-bold text-slate-200 block mt-0.5">{fmt(activeResearch.purchaseScenario.estimatedSellingPrice)}</span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Channel Fees</span>
                  <span className="text-xs font-bold text-rose-400 block mt-0.5">-{fmt(activeResearch.purchaseScenario.estimatedFees)}</span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Shipping Est.</span>
                  <span className="text-xs font-bold text-slate-300 block mt-0.5">{fmt(activeResearch.purchaseScenario.estimatedShipping)}</span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Net Proceeds</span>
                  <span className="text-xs font-bold text-blue-400 block mt-0.5">{fmt(activeResearch.purchaseScenario.estimatedNetProceeds)}</span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Est. Profit</span>
                  <span className={`text-xs font-bold block mt-0.5 ${
                    activeResearch.purchaseScenario.potentialProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}>
                    {fmt(activeResearch.purchaseScenario.potentialProfit)}
                  </span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Est. Margin</span>
                  <span className={`text-xs font-bold block mt-0.5 ${
                    activeResearch.purchaseScenario.potentialMargin >= 20
                      ? "text-emerald-400"
                      : activeResearch.purchaseScenario.potentialMargin >= 0
                      ? "text-blue-400"
                      : "text-rose-400"
                  }`}>
                    {fmtPct(activeResearch.purchaseScenario.potentialMargin)}
                  </span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 uppercase block">Breakeven Floor</span>
                  <span className="text-xs font-bold text-amber-400 block mt-0.5">{fmt(activeResearch.purchaseScenario.breakevenPrice)}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 bg-slate-900/50 rounded-lg border border-slate-800/80">
                Cost basis not provided — profitability cannot be calculated. Enter a hypothetical purchase cost above to test margin & breakeven scenarios.
              </div>
            )}
          </div>

          {/* Market Evidence Table */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>📋</span> Market Evidence ({activeResearch.observations.length} Observations)
              </h4>
              <span className="text-[10px] text-slate-500">Synthetic observations strictly excluded</span>
            </div>

            {activeResearch.observations.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400">
                {activeResearch.message || "No genuine market observations found."}
              </div>
            ) : (
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800 tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Source</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3 text-right">Price</th>
                      <th className="py-2.5 px-3">Condition</th>
                      <th className="py-2.5 px-3">Seller</th>
                      <th className="py-2.5 px-3">Captured</th>
                      <th className="py-2.5 px-3">Provenance</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-300">
                    {activeResearch.observations.map((obs) => (
                      <tr key={obs.id} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-white">{obs.source}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                            obs.priceType === "SOLD_PRICE"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                              : obs.priceType === "CURRENT_BID"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                              : "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                          }`}>
                            {obs.priceType.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                          {fmt(obs.price)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                          {obs.condition ? obs.condition.replace("_", " ") : "N/A"}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px] truncate max-w-[140px]">
                          {obs.seller || "Catawiki Seller"}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                          {new Date(obs.capturedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-mono text-slate-400 font-semibold">
                            {obs.provenance}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {obs.externalUrl ? (
                            <a
                              href={obs.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-bold text-blue-400 hover:text-blue-300 underline"
                            >
                              View Listing ↗
                            </a>
                          ) : (
                            <span className="text-slate-600 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ========================================================================= */}
      {/* 4. ACTIVE PORTFOLIO RECOMMENDATIONS                                      */}
      {/* ========================================================================= */}
      <section className="space-y-4 pt-4 border-t border-slate-800">
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
              disabled={isSweeping || !canEdit}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer"
            >
              <span>{isSweeping ? "⏳" : "⚡"}</span>
              <span>{isSweeping ? "Evaluating Portfolio..." : "Run Pricing Engine Sweep"}</span>
            </button>
          </div>
        </div>

        {recommendations.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center space-y-3 max-w-lg mx-auto">
            <span className="text-4xl">✓</span>
            <h3 className="font-bold text-white text-lg">Portfolio Margins Optimized!</h3>
            <p className="text-slate-400 text-xs font-medium">
              There are no active pricing recommendations pending review. Click &quot;Run Pricing Engine Sweep&quot; to scan the catalog against the latest Catawiki market observations.
            </p>
            <button
              onClick={handleRunEngine}
              disabled={isSweeping || !canEdit}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              {isSweeping ? "Running Sweep..." : "Run Pricing Engine Now"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 max-w-5xl">
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

              // Truthful confidence: never fallback to 75%
              const confidence = rec.confidenceScore !== undefined && rec.confidenceScore !== null
                ? rec.confidenceScore
                : null;
              const tier = rec.confidenceTier || "Unknown";

              return (
                <div
                  key={rec.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col transition-all hover:border-slate-700"
                >
                  {/* Header info */}
                  <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-slate-950 text-slate-300 border border-slate-800">
                          Set {rec.variant.setNumber}
                        </span>
                        <span className="text-slate-400 text-[10px] font-semibold uppercase">
                          {rec.variant.condition.replace("_", " ")}
                        </span>
                        {/* Truthful Structured Confidence Badge */}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                          confidence !== null && confidence >= 80
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : confidence !== null && confidence >= 50
                            ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        }`}>
                          {confidence !== null ? `${confidence}% (${tier})` : "Unknown Confidence"}
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
                    <div className="flex gap-6 shrink-0 bg-slate-950 px-4 py-3 rounded-lg text-center border border-slate-800">
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
                      <div className="border-l border-slate-800 h-8 self-center" />
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                          Suggested Price
                        </span>
                        <span className="text-xs font-bold text-emerald-400 block mt-0.5">
                          {fmt(rec.recommendedPrice)}
                        </span>
                        {margin !== null && (
                          <span className="text-[9px] text-emerald-400/80 font-bold block">
                            +{fmt(netProfit)} ({margin.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-6 flex-1 flex flex-col justify-between gap-6">
                    <div className="space-y-4">
                      {/* Marketplace current listings comparison */}
                      {rec.variant.listings.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                            Live Store Listings
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {rec.variant.listings.map((l) => (
                              <div
                                key={l.id}
                                className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-xs"
                              >
                                <span className="font-bold text-slate-300">{l.marketplace}</span>
                                <span className="text-slate-400">·</span>
                                <span className="font-mono text-white">{fmt(l.price)}</span>
                                <span className="text-slate-400">·</span>
                                <span className={rec.recommendedPrice > l.price ? "text-emerald-400" : "text-amber-400"}>
                                  {rec.recommendedPrice > l.price ? "▲" : "▼"} {fmt(Math.abs(rec.recommendedPrice - l.price))}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Engine Rationale Narrative */}
                      <div className="space-y-1 bg-slate-950 p-4 rounded-lg border border-slate-800">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <span>💡</span> Recommendation Reasoning
                        </span>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {rec.reasoning}
                        </p>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                      <button
                        onClick={() => handleRefreshSet(rec.variant.setNumber)}
                        disabled={isRefreshing || !canEdit}
                        className="text-[11px] text-slate-400 hover:text-white font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <span>{isRefreshing ? "⏳" : "🔄"}</span>
                        <span>{isRefreshing ? "Refreshing Bids..." : "Refresh Catawiki Bids"}</span>
                      </button>

                      <button
                        onClick={() => handleAccept(rec.id)}
                        disabled={isActing || !canEdit}
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer flex items-center gap-2"
                      >
                        {isActing ? (
                          <>
                            <span className="animate-spin">⌛</span>
                            <span>Applying Price...</span>
                          </>
                        ) : (
                          <>
                            <span>✓</span>
                            <span>Accept & Update Channels</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ========================================================================= */}
      {/* 5. ADD TO INVENTORY MODAL (POST-RESEARCH)                                */}
      {/* ========================================================================= */}
      {showAddModal && activeResearch && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>➕</span> Add Set {activeResearch.setNumber} to Inventory
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{activeResearch.productName}</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    SKU <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={addSku}
                    onChange={(e) => setAddSku(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Condition <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={addCondition}
                    onChange={(e) => setAddCondition(e.target.value as ProductCondition)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value={ProductCondition.NEW_SEALED}>NEW_SEALED</option>
                    <option value={ProductCondition.USED_COMPLETE}>USED_COMPLETE</option>
                    <option value={ProductCondition.DAMAGED_BOX}>DAMAGED_BOX</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Quantity <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={addQuantity}
                    onChange={(e) => setAddQuantity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Unit Purchase Cost (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Leave empty for unknown cost"
                    value={addUnitCost}
                    onChange={(e) => setAddUnitCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Storage Location
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Shelf B-02"
                    value={addLocation}
                    onChange={(e) => setAddLocation(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Supplier / Source
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Wholesale Dist"
                    value={addSupplier}
                    onChange={(e) => setAddSupplier(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional intake notes"
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none resize-none"
                />
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800">
                Stock intake creates an immutable double-entry ledger transaction. Leaving cost empty will safely track stock without diluting existing cost basis.
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdd}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow cursor-pointer"
                >
                  {isSubmittingAdd ? "Recording Intake..." : "Confirm & Intake Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. DIRECT MANUAL STOCK INTAKE MODAL (+ Add LEGO / Stock)                 */}
      {/* ========================================================================= */}
      {showDirectStockModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🧱</span> Add Owned LEGO / Direct Stock Intake
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Records physical inventory and triggers pricing research</p>
              </div>
              <button
                onClick={() => setShowDirectStockModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDirectStockSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    LEGO Set Number <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 75192"
                    value={directSetNumber}
                    onChange={(e) => {
                      setDirectSetNumber(e.target.value);
                      if (!directSku || directSku.startsWith("LGO-")) {
                        setDirectSku(`LGO-${e.target.value.trim()}-NEW`);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    SKU <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. LGO-75192-NEW"
                    value={directSku}
                    onChange={(e) => setDirectSku(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Condition <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={directCondition}
                    onChange={(e) => setDirectCondition(e.target.value as ProductCondition)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  >
                    <option value={ProductCondition.NEW_SEALED}>NEW_SEALED</option>
                    <option value={ProductCondition.USED_COMPLETE}>USED_COMPLETE</option>
                    <option value={ProductCondition.DAMAGED_BOX}>DAMAGED_BOX</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Quantity <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={directQuantity}
                    onChange={(e) => setDirectQuantity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Unit Cost (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Optional"
                    value={directUnitCost}
                    onChange={(e) => setDirectUnitCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Product Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-resolved if catalog matches"
                    value={directProductName}
                    onChange={(e) => setDirectProductName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Theme (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Star Wars"
                    value={directTheme}
                    onChange={(e) => setDirectTheme(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Storage Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Warehouse 1"
                    value={directLocation}
                    onChange={(e) => setDirectLocation(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Supplier</label>
                  <input
                    type="text"
                    placeholder="e.g. LEGO Shop Direct"
                    value={directSupplier}
                    onChange={(e) => setDirectSupplier(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional intake comments"
                  value={directNotes}
                  onChange={(e) => setDirectNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-750 focus:border-blue-500 rounded-lg px-3 py-2 text-xs text-white outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDirectStockModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDirect}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow cursor-pointer"
                >
                  {isSubmittingDirect ? "Recording & Evaluating..." : "Save Stock & Run Pricing"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
