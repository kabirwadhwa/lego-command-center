import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  Boxes,
  TrendingUp,
  AlertTriangle,
  ShoppingBag,
  ArrowRight,
  Package,
} from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 1. Fetch Company Inventory Summary
  const companyBalances = await prisma.inventoryBalance.findMany({
    where: { inventoryAccount: { type: "COMPANY" } },
    include: { productVariant: true }
  });

  const companyValue = companyBalances.reduce((sum, bal) => {
    return sum + (bal.quantity * Number(bal.averageCost));
  }, 0);

  // 2. Fetch Personal Inventory Summary
  const personalBalances = await prisma.inventoryBalance.findMany({
    where: { inventoryAccount: { type: "PERSONAL" } },
    include: { productVariant: true }
  });

  const personalValue = personalBalances.reduce((sum, bal) => {
    return sum + (bal.quantity * Number(bal.averageCost));
  }, 0);

  // 3. Fetch Total Inventory Units
  const totalUnits = await prisma.inventoryBalance.aggregate({
    _sum: { quantity: true }
  });

  // 4. Fetch Sales Metrics (This Month)
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const salesThisMonth = await prisma.sale.findMany({
    where: { saleDate: { gte: startOfMonth } },
    include: { items: true }
  });

  const revenueThisMonth = salesThisMonth.reduce((sum, sale) => sum + Number(sale.grossRevenue), 0);
  const costOfGoodsSold = salesThisMonth.reduce((sum, sale) => {
    return sum + sale.items.reduce((s, item) => s + (item.quantity * Number(item.unitCostAtSale)), 0);
  }, 0);
  const profitThisMonth = revenueThisMonth - costOfGoodsSold;

  // 5. Fetch Operational Notifications (Alerts & Mismatches)
  const activeAlerts = await prisma.alert.findMany({
    where: { resolved: false },
    take: 5,
    orderBy: { createdAt: "desc" },
    include: { productVariant: { include: { product: true } } }
  });

  // 6. Fetch Recent Sales
  const recentSales = await prisma.sale.findMany({
    take: 5,
    orderBy: { saleDate: "desc" },
    include: { items: { include: { productVariant: { include: { product: true } } } } }
  });

  // Format currency helpers
  const fmt = (val: number) => {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(val);
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Page Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Operations Dashboard
          </h1>
          <p className="text-slate-500 text-xs mt-1.5 font-medium">
            Welcome back, {user.name}. Here is an overview of your retail assets and order synchronization status.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Company Stock Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Company Stock Value
            </span>
            <div className="p-1.5 bg-blue-50 dark:bg-blue-900/10 text-blue-600 rounded-lg">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {fmt(companyValue)}
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-semibold">
              Vervliet Enterprises Assets
            </p>
          </div>
        </div>

        {/* Personal Stock Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Personal Stock Value
            </span>
            <div className="p-1.5 bg-purple-50 dark:bg-purple-900/10 text-purple-600 rounded-lg">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {fmt(personalValue)}
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-semibold">
              Stock X Portfolio
            </p>
          </div>
        </div>

        {/* Total Units Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Total Physical Units
            </span>
            <div className="p-1.5 bg-amber-50 dark:bg-amber-900/10 text-amber-600 rounded-lg">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {totalUnits._sum.quantity || 0}
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-semibold">
              In Stock Across Accounts
            </p>
          </div>
        </div>

        {/* Revenue This Month Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
              Net Profit / Revenue (Month)
            </span>
            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 rounded-lg">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {fmt(revenueThisMonth)}
            </span>
            <p className="text-[10px] text-emerald-500 mt-1 font-semibold flex items-center gap-1">
              Est. Profit: {fmt(profitThisMonth)}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Columns: Recent Sales & Alerts */}
        <div className="lg:col-span-2 space-y-8">
          {/* Recent Sales Block */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">
                Recent Sales Transactions
              </h2>
              <Link href="/sales" className="text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1">
                <span>View Full List</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentSales.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 font-semibold select-none">
                  No sales recorded yet.
                </div>
              ) : (
                recentSales.map((sale) => (
                  <div key={sale.id} className="px-6 py-4 flex items-center justify-between text-xs font-semibold">
                    <div className="flex flex-col min-w-0 pr-4">
                      <span className="text-slate-800 dark:text-slate-200 font-bold truncate">
                        {sale.items.map(item => item.productVariant.product.name).join(", ") || "Manual Sale"}
                      </span>
                      <span className="text-[10px] text-slate-400 mt-1 font-semibold uppercase tracking-wide">
                        {sale.marketplaceId || "OFFLINE"} • Order Reference: {sale.externalOrderId || "N/A"}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold text-slate-900 dark:text-white block">
                        {fmt(Number(sale.grossRevenue))}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium mt-0.5 block">
                        {new Date(sale.saleDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Column: Needs Attention / Alerts */}
        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Needs Attention</span>
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {activeAlerts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 font-semibold select-none">
                  All systems operational. No active alerts.
                </div>
              ) : (
                activeAlerts.map((alert) => (
                  <div key={alert.id} className="p-5 flex gap-3 text-xs font-medium">
                    <div className="mt-0.5">
                      <AlertTriangle className={`w-4 h-4 ${
                        alert.severity === "CRITICAL" ? "text-red-500" : "text-amber-500"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider block text-slate-400 select-none">
                        {alert.type}
                      </span>
                      <p className="text-slate-700 dark:text-slate-300 mt-1 leading-relaxed text-xs">
                        {alert.message}
                      </p>
                      {alert.productVariant && (
                        <Link
                          href={`/inventory/${alert.productVariant.id}`}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline mt-2 inline-block"
                        >
                          Resolve Mismatch
                        </Link>
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
