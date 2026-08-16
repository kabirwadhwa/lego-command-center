import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BarChart3, TrendingUp, PieChart, Info, Package } from "lucide-react";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 1. Fetch Sales Aggregations
  const sales = await prisma.sale.findMany({
    include: { items: true },
  });

  const grossRevenue = sales.reduce((sum, s) => sum + Number(s.grossRevenue), 0);
  const netRevenue = sales.reduce((sum, s) => sum + Number(s.netRevenue), 0);
  const fees = sales.reduce((sum, s) => sum + Number(s.marketplaceFees), 0);
  const shippingCost = sales.reduce((sum, s) => sum + Number(s.shippingCost), 0);
  const discounts = sales.reduce((sum, s) => sum + Number(s.discount), 0);

  const cogs = sales.reduce((sum, s) => {
    return sum + s.items.reduce((s2, item) => s2 + item.quantity * Number(item.unitCostAtSale), 0);
  }, 0);

  const netProfit = netRevenue - cogs;
  const marginPercentage = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;
  const aov = sales.length > 0 ? grossRevenue / sales.length : 0;

  // 2. Fetch Top Selling Products
  const saleItemsGrouped = await prisma.saleItem.groupBy({
    by: ["productVariantId"],
    _sum: {
      quantity: true,
      lineRevenue: true,
    },
    orderBy: {
      _sum: {
        quantity: "desc",
      },
    },
    take: 5,
  });

  const topSellers = await Promise.all(
    saleItemsGrouped.map(async (group) => {
      const variant = await prisma.productVariant.findUnique({
        where: { id: group.productVariantId },
        include: { product: true },
      });
      return {
        sku: variant?.sku || "N/A",
        name: variant?.product.name || "Unknown Product",
        setNumber: variant?.product.setNumber || "N/A",
        quantitySold: group._sum.quantity || 0,
        revenue: Number(group._sum.lineRevenue || 0),
      };
    })
  );

  // 3. Fetch Slow Moving Inventory (Variants with stock > 5 but low/zero sales)
  const balances = await prisma.inventoryBalance.findMany({
    where: { quantity: { gt: 5 } },
    include: {
      productVariant: {
        include: { product: true },
      },
    },
    orderBy: { quantity: "desc" },
    take: 5,
  });

  const slowMoving = await Promise.all(
    balances.map(async (bal) => {
      // Find quantity sold in last 90 days
      const sold = await prisma.saleItem.aggregate({
        where: {
          productVariantId: bal.productVariantId,
          sale: {
            saleDate: {
              // eslint-disable-next-line react-hooks/purity
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
        },
        _sum: { quantity: true },
      });

      return {
        sku: bal.productVariant.sku,
        name: bal.productVariant.product.name,
        setNumber: bal.productVariant.product.setNumber,
        stockCount: bal.quantity,
        cogsValue: bal.quantity * Number(bal.averageCost),
        soldLast90Days: sold._sum.quantity || 0,
      };
    })
  );

  // 4. Group sales by channel for a simple chart representation
  const channelBreakdown = sales.reduce((acc: Record<string, number>, s) => {
    const channel = s.marketplaceId || "OFFLINE";
    acc[channel] = (acc[channel] || 0) + Number(s.grossRevenue);
    return acc;
  }, {});

  const totalChannelsValue = Object.values(channelBreakdown).reduce((a, b) => a + b, 0);

  const fmt = (val: number) => {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(val);
  };

  return (
    <div className="space-y-8 font-sans transition-colors duration-200">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Commercial Analytics & Margins
        </h1>
        <p className="text-slate-500 text-xs mt-1.5 font-medium">
          Deeper insights into your profitability, product performance, and asset allocations.
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Gross Revenue */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
            Gross Commercial Revenue
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-white mt-3 block">
            {fmt(grossRevenue)}
          </span>
          <p className="text-[10px] text-slate-400 mt-1 font-semibold">
            Average Order Value: {fmt(aov)}
          </p>
        </div>

        {/* Cost of Goods Sold */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
            Cost of Goods Sold (COGS)
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-white mt-3 block">
            {fmt(cogs)}
          </span>
          <p className="text-[10px] text-slate-400 mt-1 font-semibold">
            Calculated from historic acquisition averages
          </p>
        </div>

        {/* Net Profit */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
            Net Profit (Settled)
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-white mt-3 block">
            {fmt(netProfit)}
          </span>
          <p className="text-[10px] text-emerald-500 mt-1 font-semibold">
            Deducted fees, shipping costs, discounts
          </p>
        </div>

        {/* Operating Margin */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
            Operating Net Margin
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-white mt-3 block">
            {marginPercentage.toFixed(2)}%
          </span>
          <p className="text-[10px] text-slate-400 mt-1 font-semibold">
            Percentage profit on gross sales
          </p>
        </div>
      </div>

      {/* Graphs / Charts split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Marketplace sales breakdown (1/3 width) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
          <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
            <PieChart className="w-4 h-4 text-purple-600" />
            <span>Marketplace Channels</span>
          </h2>
          
          <div className="space-y-4">
            {Object.entries(channelBreakdown).map(([channel, val]) => {
              const share = totalChannelsValue > 0 ? (val / totalChannelsValue) * 100 : 0;
              return (
                <div key={channel} className="text-xs font-semibold text-slate-700 dark:text-slate-350 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="uppercase tracking-wide text-[10px] text-slate-400">{channel}</span>
                    <span>{fmt(val)} ({share.toFixed(1)}%)</span>
                  </div>
                  {/* CSS Progress Bar */}
                  <div className="w-full bg-slate-100 dark:bg-slate-950 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {Object.keys(channelBreakdown).length === 0 && (
              <p className="text-center text-xs text-slate-400 font-semibold py-8">
                No channel orders logged.
              </p>
            )}
          </div>
        </div>

        {/* Detailed Profit & Loss statement (2/3 width) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
          <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-650" />
            <span>Financial Profit & Loss Statement (P&L)</span>
          </h2>

          <div className="divide-y divide-slate-100 dark:divide-slate-850 text-xs font-semibold text-slate-700 dark:text-slate-350 space-y-3.5 pt-2">
            <div className="flex justify-between pt-3.5 first:pt-0">
              <span className="text-slate-950 dark:text-white font-bold">Gross Revenue</span>
              <span className="font-extrabold text-slate-900 dark:text-white">{fmt(grossRevenue)}</span>
            </div>
            <div className="flex justify-between pt-3.5">
              <span>(-) Marketplace Transaction Fees</span>
              <span className="text-red-500 font-bold">-{fmt(fees)}</span>
            </div>
            <div className="flex justify-between pt-3.5">
              <span>(-) Shipping Cost</span>
              <span className="text-red-500 font-bold">-{fmt(shippingCost)}</span>
            </div>
            <div className="flex justify-between pt-3.5">
              <span>(-) Discounts Offered</span>
              <span className="text-red-500 font-bold">-{fmt(discounts)}</span>
            </div>
            <div className="flex justify-between pt-3.5 border-t border-slate-200 dark:border-slate-800 font-extrabold text-slate-900 dark:text-white">
              <span>Net Settled Revenue</span>
              <span>{fmt(netRevenue)}</span>
            </div>
            <div className="flex justify-between pt-3.5">
              <span>(-) Cost of Goods Sold (COGS)</span>
              <span className="text-red-500 font-bold">-{fmt(cogs)}</span>
            </div>
            <div className="flex justify-between pt-3.5 border-t-2 border-slate-200 dark:border-slate-800 font-black text-sm text-slate-950 dark:text-white bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg">
              <span>Net Profit</span>
              <span className="text-emerald-600">{fmt(netProfit)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Sellers & Slow Moving split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Sellers */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span>Top Performing Products</span>
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {topSellers.map((item, idx) => (
              <div key={idx} className="px-6 py-4 flex items-center justify-between text-xs font-semibold">
                <div className="min-w-0 pr-4">
                  <span className="text-slate-900 dark:text-slate-200 font-bold block truncate">
                    {item.setNumber} - {item.name}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium mt-0.5 block">
                    SKU: {item.sku}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-bold text-slate-950 dark:text-white block">
                    {item.quantitySold} units sold
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium mt-0.5 block">
                    Revenue: {fmt(item.revenue)}
                  </span>
                </div>
              </div>
            ))}
            {topSellers.length === 0 && (
              <p className="text-center text-xs text-slate-400 font-semibold py-8 select-none">
                No product sales statistics aggregated.
              </p>
            )}
          </div>
        </div>

        {/* Slow Moving Inventory */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              <span>Slow Moving Capital Assets</span>
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {slowMoving.map((item, idx) => (
              <div key={idx} className="px-6 py-4 flex items-center justify-between text-xs font-semibold">
                <div className="min-w-0 pr-4">
                  <span className="text-slate-900 dark:text-slate-200 font-bold block truncate">
                    {item.setNumber} - {item.name}
                  </span>
                  <span className="text-[10px] text-slate-450 font-medium mt-0.5 block flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-slate-350" />
                    Capital tied up: {fmt(item.cogsValue)}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-bold text-slate-950 dark:text-white block">
                    {item.stockCount} units in stock
                  </span>
                  <span className="text-[10px] text-red-500 font-medium mt-0.5 block">
                    Sold last 90d: {item.soldLast90Days}
                  </span>
                </div>
              </div>
            ))}
            {slowMoving.length === 0 && (
              <p className="text-center text-xs text-slate-400 font-semibold py-8 select-none">
                All inventory assets showing regular velocity.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
