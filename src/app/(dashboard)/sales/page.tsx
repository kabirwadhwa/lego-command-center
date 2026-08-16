import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Calendar } from "lucide-react";
import Link from "next/link";

export default async function SalesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 1. Fetch sales logs sorted by date desc
  const sales = await prisma.sale.findMany({
    orderBy: { saleDate: "desc" },
    include: {
      items: {
        include: {
          productVariant: {
            include: { product: true },
          },
          inventoryAccount: true,
        },
      },
    },
  });

  const fmt = (val: string | number | object | unknown) => {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(val));
  };

  return (
    <div className="space-y-6 font-sans transition-colors duration-200">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Commercial Orders & Sales
          </h1>
          <p className="text-slate-500 text-xs mt-1.5 font-medium">
            Monitor offline sales transactions and synchronized external marketplace orders.
          </p>
        </div>
        {user.role !== "VIEWER" && (
          <Link
            href="/sales?action=sell"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors"
          >
            <span>Record Offline Sale</span>
          </Link>
        )}
      </div>

      {/* Sales Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight">
            Order Settlement History
          </h2>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {sales.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400 font-semibold select-none">
              No sales transactions recorded yet.
            </div>
          ) : (
            sales.map((sale) => {
              // Calculate derived totals
              const cogs = sale.items.reduce((sum, item) => {
                return sum + item.quantity * Number(item.unitCostAtSale);
              }, 0);
              const gross = Number(sale.grossRevenue);
              const fees = Number(sale.marketplaceFees);
              const shippingCost = Number(sale.shippingCost);
              const profit = Number(sale.netRevenue) - cogs;
              const margin = gross > 0 ? (profit / gross) * 100 : 0;

              return (
                <div key={sale.id} className="p-6 space-y-4">
                  <div className="flex justify-between items-start text-xs font-semibold">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white text-sm">
                          Order Reference: {sale.externalOrderId || `LGO-SL-${sale.id.substring(0, 8).toUpperCase()}`}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide select-none ${
                          sale.marketplaceId
                            ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40"
                        }`}>
                          {sale.marketplaceId || "OFFLINE SALE"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] text-slate-400 uppercase tracking-wide">
                        <span className="flex items-center gap-1 font-semibold">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(sale.saleDate).toLocaleDateString()}
                        </span>
                        <span>• Status: {sale.status}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-extrabold text-slate-950 dark:text-white text-sm block">
                        Gross: {fmt(gross)}
                      </span>
                      <span className="text-[10px] text-slate-500 font-semibold mt-1 block">
                        Net Settlement: {fmt(Number(sale.netRevenue))}
                      </span>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-850 rounded-lg p-4 text-[11px] font-semibold text-slate-600 dark:text-slate-400 space-y-3">
                    {sale.items.map((item) => (
                      <div key={item.id} className="flex justify-between items-center">
                        <div className="min-w-0 pr-4">
                          <span className="text-slate-850 dark:text-slate-200 font-bold block truncate">
                            {item.productVariant.product.setNumber} - {item.productVariant.product.name} ({item.productVariant.condition.replace("_", " ")})
                          </span>
                          <span className="text-[9px] text-slate-400 font-medium block mt-0.5">
                            SKU: {item.productVariant.sku} • Cost Basis at Sale: {fmt(Number(item.unitCostAtSale))} • Account: {item.inventoryAccount.name}
                          </span>
                        </div>
                        <div className="text-right shrink-0 text-slate-900 dark:text-white font-bold">
                          {item.quantity} x {fmt(Number(item.unitSalePrice))}
                        </div>
                      </div>
                    ))}

                    {/* Financial Reconciliation Breakdown */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex flex-wrap justify-between gap-4 text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                      <div className="flex gap-4">
                        <span>COGS: <strong className="text-slate-700 dark:text-slate-300 font-bold normal-case">{fmt(cogs)}</strong></span>
                        {fees > 0 && <span>Fees: <strong className="text-slate-700 dark:text-slate-300 font-bold normal-case">{fmt(fees)}</strong></span>}
                        {shippingCost > 0 && <span>Shipping Cost: <strong className="text-slate-700 dark:text-slate-300 font-bold normal-case">{fmt(shippingCost)}</strong></span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Margin:</span>
                        <span className={`font-black ${profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {fmt(profit)} ({margin.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  {sale.notes && (
                    <p className="text-[10px] text-slate-400 font-medium italic">
                      &ldquo;{sale.notes}&rdquo;
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
