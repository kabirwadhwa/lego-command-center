import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  ArrowLeft,
  Boxes,
  Package,
  Tags,
  History,
  ShoppingCart,
  ExternalLink,
  ChevronRight,
  TrendingDown,
} from "lucide-react";

export default async function VariantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;

  // 1. Fetch Variant details from database
  const variant = await prisma.productVariant.findUnique({
    where: { id },
    include: {
      product: {
        include: {
          snapshots: {
            orderBy: { capturedAt: "desc" },
            take: 10,
          },
        },
      },
      balances: {
        include: { inventoryAccount: true },
      },
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      listings: true,
      recommendations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      alerts: {
        where: { resolved: false },
      },
    },
  });

  if (!variant) {
    notFound();
  }

  const companyBal = variant.balances.find((b) => b.inventoryAccount.type === "COMPANY");
  const personalBal = variant.balances.find((b) => b.inventoryAccount.type === "PERSONAL");

  const compQty = companyBal?.quantity || 0;
  const persQty = personalBal?.quantity || 0;
  const totQty = compQty + persQty;

  const compCost = companyBal ? Number(companyBal.averageCost) : 0;
  const persCost = personalBal ? Number(personalBal.averageCost) : 0;
  const weightedCost = totQty > 0 ? (compQty * compCost + persQty * persCost) / totQty : 0;

  // Format currency helpers
  const fmt = (val: string | number | object | Prisma.Decimal | unknown) => {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(val));
  };

  // Identify listings
  const shopifyListing = variant.listings.find((l) => l.marketplace === "SHOPIFY");
  const bolListing = variant.listings.find((l) => l.marketplace === "BOL");
  const catawikiListing = variant.listings.find((l) => l.marketplace === "CATAWIKI");

  // Get pricing recommendations
  const recommendation = variant.recommendations[0];

  return (
    <div className="space-y-8 font-sans transition-colors duration-200">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 select-none">
        <Link href="/inventory" className="hover:text-slate-700 flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Catalog</span>
        </Link>
        <ChevronRight className="w-3 h-3 text-slate-300" />
        <span className="text-slate-400">Set #{variant.product.setNumber}</span>
      </div>

      {/* Header Info */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 dark:border-slate-800 pb-6 gap-4">
        <div className="flex items-center gap-5">
          {/* Mock Product Image / Placeholder */}
          <div className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-400 select-none shrink-0 font-bold text-sm">
            {variant.product.setNumber}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">
                {variant.product.name}
              </h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide select-none ${
                variant.condition === "NEW_SEALED"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40"
                  : variant.condition === "DAMAGED_BOX"
                  ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40"
                  : "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40"
              }`}>
                {variant.condition.replace("_", " ")}
              </span>
            </div>
            <p className="text-slate-500 text-xs mt-1.5 font-medium">
              Theme: {variant.product.theme} • SKU: {variant.sku} • EAN: {variant.product.ean || "N/A"}
            </p>
          </div>
        </div>

        {/* Action Button Group */}
        {user.role !== "VIEWER" && (
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <Link
              href={`/sales?action=sell&sku=${variant.sku}`}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors"
            >
              Sell Product
            </Link>
            <Link
              href={`/purchases?action=receive&sku=${variant.sku}`}
              className="px-3.5 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors"
            >
              Add Stock
            </Link>
            <Link
              href={`/inventory?action=transfer&sku=${variant.sku}`}
              className="px-3.5 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors"
            >
              Transfer
            </Link>
            <Link
              href={`/inventory?action=adjust&sku=${variant.sku}`}
              className="px-3.5 py-1.5 bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors"
            >
              Adjust
            </Link>
          </div>
        )}
      </div>

      {/* Stock Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Company Stock Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Company Stock
            </span>
            <div className="p-1.5 bg-blue-50 dark:bg-blue-900/10 text-blue-600 rounded-lg">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {compQty} <span className="text-xs font-semibold text-slate-400">units</span>
            </span>
            <p className="text-[10px] text-slate-500 font-semibold mt-1">
              Avg Cost basis: {fmt(compCost)}
            </p>
          </div>
        </div>

        {/* Personal Stock Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Personal Stock
            </span>
            <div className="p-1.5 bg-purple-50 dark:bg-purple-900/10 text-purple-600 rounded-lg">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {persQty} <span className="text-xs font-semibold text-slate-400">units</span>
            </span>
            <p className="text-[10px] text-slate-500 font-semibold mt-1">
              Avg Cost basis: {fmt(persCost)}
            </p>
          </div>
        </div>

        {/* Combined Stock Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Total Owned Stock
            </span>
            <div className="p-1.5 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {totQty} <span className="text-xs font-semibold text-slate-400">units</span>
            </span>
            <p className="text-[10px] text-slate-500 font-semibold mt-1">
              Weighted cost basis: {fmt(weightedCost)}
            </p>
          </div>
        </div>
      </div>

      {/* Main content split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Columns: Pricing Engine & Marketplace sync */}
        <div className="lg:col-span-2 space-y-8">
          {/* Pricing Engine card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden p-6 space-y-6">
            <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
              <Tags className="w-4 h-4 text-blue-600" />
              <span>Pricing Recommendation Engine</span>
            </h2>

            {recommendation ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Recommended Price
                    </span>
                    <span className="text-2xl font-extrabold text-slate-950 dark:text-white block mt-1.5">
                      {fmt(Number(recommendation.recommendedPrice))}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Acquisition Cost Basis
                    </span>
                    <span className="text-sm font-bold text-slate-500 block mt-1">
                      {fmt(weightedCost)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 pt-4 md:pt-0 md:pl-6 leading-relaxed">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Recommendation Reasoning
                  </span>
                  <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                    {recommendation.reasoning}
                  </p>
                  {user.role !== "VIEWER" && (
                    <button className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline mt-3 block">
                      Accept and Update Listing Prices →
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-5 text-center text-xs text-slate-400 font-semibold select-none">
                No pricing recommendations generated yet for this variant.
              </div>
            )}
          </div>

          {/* Ledger History List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
                <History className="w-4 h-4 text-slate-500" />
                <span>Audit Inventory Ledger Logs</span>
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {variant.transactions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 font-semibold select-none">
                  No stock movements logged.
                </div>
              ) : (
                variant.transactions.map((tx) => (
                  <div key={tx.id} className="px-6 py-4 flex items-center justify-between text-xs font-semibold">
                    <div className="flex flex-col min-w-0 pr-4">
                      <span className="text-slate-950 dark:text-white font-bold truncate">
                        {tx.type} ({tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity} units)
                      </span>
                      <span className="text-[10px] text-slate-400 mt-1 font-semibold uppercase tracking-wide">
                        Account: {tx.inventoryAccountId === companyBal?.inventoryAccountId ? "Company Stock" : "Personal Stock"} • Actor: {tx.actorName} ({tx.actorType.toLowerCase()})
                      </span>
                      {tx.notes && (
                        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed italic">
                          &ldquo;{tx.notes}&rdquo;
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {tx.unitCost && (
                        <span className="font-bold text-slate-800 dark:text-slate-200 block">
                          Cost: {fmt(Number(tx.unitCost))}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 font-medium mt-0.5 block">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Column: Marketplace listings & Prices */}
        <div className="space-y-8">
          {/* Active Listings on Marketplaces */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-emerald-600" />
              <span>Active Marketplace Listings</span>
            </h2>

            <div className="space-y-4 text-xs font-semibold">
              {/* Shopify Listing */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">
                    Shopify
                  </span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                    {shopifyListing ? fmt(shopifyListing.price) : "Not Connected"}
                  </span>
                </div>
                <div className="text-right">
                  {shopifyListing ? (
                    <>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 select-none">
                        Active ({shopifyListing.quantity} in sync)
                      </span>
                      <span className="text-[9px] text-slate-400 font-medium block mt-1">
                        Ref: {shopifyListing.externalListingId.substring(0, 10)}...
                      </span>
                    </>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 select-none">
                      Draft
                    </span>
                  )}
                </div>
              </div>

              {/* Bol Plaza Listing */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">
                    Bol.com
                  </span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                    {bolListing ? fmt(bolListing.price) : "Not Connected"}
                  </span>
                </div>
                <div className="text-right">
                  {bolListing ? (
                    <>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 select-none">
                        Active ({bolListing.quantity} in sync)
                      </span>
                      <span className="text-[9px] text-slate-400 font-medium block mt-1">
                        Ref: {bolListing.externalListingId.substring(0, 10)}...
                      </span>
                    </>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 select-none">
                      Draft
                    </span>
                  )}
                </div>
              </div>

              {/* Catawiki Auction Listing */}
              <div className="flex flex-col p-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">
                      Catawiki
                    </span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 block">
                      {catawikiListing ? fmt(catawikiListing.price) : "Not Connected"}
                    </span>
                  </div>
                  <div className="text-right">
                    {catawikiListing ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 select-none">
                        Live Auction
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 select-none">
                        Draft
                      </span>
                    )}
                  </div>
                </div>

                {catawikiListing && (
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-1.5 text-[10px] text-slate-500 leading-normal">
                    {catawikiListing.catawikiCurrentBid && (
                      <div className="flex justify-between">
                        <span>Current Bid:</span>
                        <strong className="text-slate-800 dark:text-slate-200">{fmt(catawikiListing.catawikiCurrentBid)}</strong>
                      </div>
                    )}
                    {catawikiListing.catawikiReserve && (
                      <div className="flex justify-between">
                        <span>Reserve Price:</span>
                        <strong className="text-slate-800 dark:text-slate-200">{fmt(catawikiListing.catawikiReserve)}</strong>
                      </div>
                    )}
                    {catawikiListing.catawikiAuctionEnd && (
                      <div className="flex justify-between text-amber-600 font-bold">
                        <span>Closes:</span>
                        <span>{new Date(catawikiListing.catawikiAuctionEnd).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Market Price Observations */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-purple-600" />
              <span>Market Price Observations</span>
            </h2>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 space-y-3.5">
              {variant.product.snapshots.length === 0 ? (
                <div className="text-center text-xs text-slate-400 font-semibold select-none py-4">
                  No market price data ingested.
                </div>
              ) : (
                variant.product.snapshots.map((snap) => (
                  <div key={snap.id} className="flex justify-between items-center text-xs font-semibold pt-3.5 first:pt-0">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block">
                        {snap.marketplace.replace("_", " ")}
                      </span>
                      <span className="text-slate-800 dark:text-slate-200 mt-1 block">
                        {snap.seller || "Competitor"} ({snap.priceType.toLowerCase().replace("_", " ")})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-900 dark:text-white block">
                        {fmt(Number(snap.price))}
                      </span>
                      {snap.shipping && (
                        <span className="text-[9px] text-slate-400 font-medium block mt-0.5">
                          + {fmt(Number(snap.shipping))} shipping
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
