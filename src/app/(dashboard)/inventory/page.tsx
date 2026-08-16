import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  ArrowUpDown,
  Plus,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    filter?: string;
    sort?: string;
    order?: string;
    page?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const search = params.search || "";
  const filter = params.filter || "all";
  const sortBy = params.sort || "sku";
  const sortOrder = params.order || "asc";
  const page = parseInt(params.page || "1", 10);
  const pageSize = 10;

  // 1. Construct Prisma query filters
  const whereClause: Prisma.ProductVariantWhereInput = {
    status: "ACTIVE", // Only active variants
  };

  // Global search (Set #, SKU, EAN, Name)
  if (search) {
    whereClause.OR = [
      { sku: { contains: search, mode: "insensitive" } },
      { product: { setNumber: { contains: search, mode: "insensitive" } } },
      { product: { name: { contains: search, mode: "insensitive" } } },
      { product: { ean: { contains: search, mode: "insensitive" } } },
    ];
  }

  // Filter types
  if (filter === "company_only") {
    whereClause.balances = {
      some: {
        inventoryAccount: { type: "COMPANY" },
        quantity: { gt: 0 },
      },
    };
  } else if (filter === "personal_only") {
    whereClause.balances = {
      some: {
        inventoryAccount: { type: "PERSONAL" },
        quantity: { gt: 0 },
      },
    };
  } else if (filter === "out_of_stock") {
    whereClause.balances = {
      none: { quantity: { gt: 0 } },
    };
  } else if (filter === "low_stock") {
    // Balances sum to <= 2
    whereClause.balances = {
      some: { quantity: { lte: 2 } },
    };
  } else if (filter === "price_opportunity") {
    whereClause.alerts = {
      some: { type: "PRICE_OPPORTUNITY", resolved: false },
    };
  } else if (filter === "needs_attention") {
    whereClause.alerts = {
      some: { resolved: false },
    };
  }

  // 2. Fetch inventory items count for pagination
  const totalItems = await prisma.productVariant.count({ where: whereClause });
  const totalPages = Math.ceil(totalItems / pageSize);

  // 3. Fetch variants with sorting and pagination
  // Prisma sorting logic
  let orderByClause: Prisma.ProductVariantOrderByWithRelationInput = {};
  if (sortBy === "sku") {
    orderByClause = { sku: sortOrder as Prisma.SortOrder };
  } else if (sortBy === "setNumber") {
    orderByClause = { product: { setNumber: sortOrder as Prisma.SortOrder } };
  } else if (sortBy === "name") {
    orderByClause = { product: { name: sortOrder as Prisma.SortOrder } };
  } else {
    // Default fallback
    orderByClause = { sku: "asc" };
  }

  const variants = await prisma.productVariant.findMany({
    where: whereClause,
    include: {
      product: true,
      balances: {
        include: { inventoryAccount: true },
      },
      alerts: {
        where: { resolved: false },
      },
      recommendations: {
        take: 1,
        orderBy: { updatedAt: "desc" },
      },
    },
    orderBy: orderByClause,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const fmt = (val: string | number | object | Prisma.Decimal | unknown) => {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(val));
  };

  const getSortLink = (field: string) => {
    const nextOrder = sortBy === field && sortOrder === "asc" ? "desc" : "asc";
    const currentParams = new URLSearchParams();
    if (search) currentParams.set("search", search);
    if (filter) currentParams.set("filter", filter);
    currentParams.set("sort", field);
    currentParams.set("order", nextOrder);
    return `/inventory?${currentParams.toString()}`;
  };

  const getFilterLink = (filterType: string) => {
    const currentParams = new URLSearchParams();
    if (search) currentParams.set("search", search);
    currentParams.set("filter", filterType);
    if (sortBy) currentParams.set("sort", sortBy);
    if (sortOrder) currentParams.set("order", sortOrder);
    return `/inventory?${currentParams.toString()}`;
  };

  const getPageLink = (pageNumber: number) => {
    const currentParams = new URLSearchParams();
    if (search) currentParams.set("search", search);
    if (filter) currentParams.set("filter", filter);
    if (sortBy) currentParams.set("sort", sortBy);
    if (sortOrder) currentParams.set("order", sortOrder);
    currentParams.set("page", pageNumber.toString());
    return `/inventory?${currentParams.toString()}`;
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Inventory Catalog
          </h1>
          <p className="text-slate-500 text-xs mt-1.5 font-medium">
            Manage your physical assets, variant conditions, and compare list prices across accounts.
          </p>
        </div>
        {user.role !== "VIEWER" && (
          <Link
            href="/inventory?action=add-product"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add LEGO Set</span>
          </Link>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        {/* Quick Filter Selects */}
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          {[
            { id: "all", label: "All Items" },
            { id: "company_only", label: "Company Only" },
            { id: "personal_only", label: "Personal Only" },
            { id: "out_of_stock", label: "Out of Stock" },
            { id: "low_stock", label: "Low Stock" },
            { id: "price_opportunity", label: "Price Opportunities" },
            { id: "needs_attention", label: "Needs Attention" },
          ].map((opt) => {
            const isSelected = filter === opt.id;
            return (
              <Link
                key={opt.id}
                href={getFilterLink(opt.id)}
                className={`px-3 py-1.5 rounded-lg border transition-all ${
                  isSelected
                    ? "bg-slate-950 text-white border-slate-950 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100 shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden transition-colors">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest select-none">
              <th className="py-3.5 px-6">
                <Link href={getSortLink("setNumber")} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300">
                  <span>Set #</span>
                  <ArrowUpDown className="w-3 h-3" />
                </Link>
              </th>
              <th className="py-3.5 px-4">
                <Link href={getSortLink("name")} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300">
                  <span>Product Name</span>
                  <ArrowUpDown className="w-3 h-3" />
                </Link>
              </th>
              <th className="py-3.5 px-4">Condition</th>
              <th className="py-3.5 px-4 text-center">Company</th>
              <th className="py-3.5 px-4 text-center">Personal</th>
              <th className="py-3.5 px-4 text-center">Total</th>
              <th className="py-3.5 px-4 text-right">Avg Cost</th>
              <th className="py-3.5 px-4 text-right">Our Price</th>
              <th className="py-3.5 px-4 text-right">Suggested</th>
              <th className="py-3.5 px-6 text-center">Alerts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
            {variants.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-12 text-center text-slate-400 font-semibold select-none">
                  No inventory items match your current filters.
                </td>
              </tr>
            ) : (
              variants.map((v) => {
                const companyBal = v.balances.find((b) => b.inventoryAccount.type === "COMPANY");
                const personalBal = v.balances.find((b) => b.inventoryAccount.type === "PERSONAL");

                const compQty = companyBal?.quantity || 0;
                const persQty = personalBal?.quantity || 0;
                const totQty = compQty + persQty;

                // Calculate average weighted cost basis
                const compCost = companyBal ? Number(companyBal.averageCost) : 0;
                const persCost = personalBal ? Number(personalBal.averageCost) : 0;
                const weightedCost = totQty > 0 ? (compQty * compCost + persQty * persCost) / totQty : 0;

                // Get active listings or recommended pricing
                const recommended = v.recommendations[0]?.recommendedPrice || 0;

                return (
                  <tr
                    key={v.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 cursor-pointer transition-colors"
                  >
                    <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                      <Link href={`/inventory/${v.id}`} className="block">
                        {v.product.setNumber}
                      </Link>
                    </td>
                    <td className="py-4 px-4 min-w-[200px]">
                      <Link href={`/inventory/${v.id}`} className="block">
                        <span className="font-bold text-slate-800 dark:text-slate-100 truncate block">
                          {v.product.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium mt-0.5 block">
                          Theme: {v.product.theme} • SKU: {v.sku}
                        </span>
                      </Link>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide select-none ${
                        v.condition === "NEW_SEALED"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40"
                          : v.condition === "DAMAGED_BOX"
                          ? "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40"
                          : "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40"
                      }`}>
                        {v.condition.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-center text-slate-900 dark:text-slate-100 font-bold">
                      {compQty}
                    </td>
                    <td className="py-4 px-4 text-center text-slate-900 dark:text-slate-100 font-bold">
                      {persQty}
                    </td>
                    <td className={`py-4 px-4 text-center font-black ${
                      totQty === 0 ? "text-slate-300 dark:text-slate-700" : "text-slate-900 dark:text-white"
                    }`}>
                      {totQty}
                    </td>
                    <td className="py-4 px-4 text-right font-medium text-slate-500">
                      {fmt(weightedCost)}
                    </td>
                    <td className="py-4 px-4 text-right font-bold text-slate-950 dark:text-white">
                      {/* Using cost basis + markup in demo layout */}
                      {fmt(weightedCost * 1.35)}
                    </td>
                    <td className="py-4 px-4 text-right font-bold text-slate-950 dark:text-white">
                      {recommended ? fmt(recommended) : "N/A"}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex justify-center gap-1.5">
                        {v.alerts.map((al) => (
                          <div
                            key={al.id}
                            title={al.message}
                            className={`p-1 rounded-md ${
                              al.type === "PRICE_OPPORTUNITY"
                                ? "bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400"
                                : al.severity === "CRITICAL"
                                ? "bg-red-50 text-red-600 dark:bg-red-950/20 dark:text-red-400"
                                : "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400"
                            }`}
                          >
                            {al.type === "PRICE_OPPORTUNITY" ? (
                              <TrendingUp className="w-3.5 h-3.5" />
                            ) : al.severity === "CRITICAL" ? (
                              <AlertCircle className="w-3.5 h-3.5" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            )}
                          </div>
                        ))}
                        {v.alerts.length === 0 && (
                          <span className="text-slate-300 dark:text-slate-700 select-none font-bold">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span className="select-none">
              Showing Page {page} of {totalPages} ({totalItems} items total)
            </span>
            <div className="flex gap-2">
              <Link
                href={page > 1 ? getPageLink(page - 1) : "#"}
                className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors ${
                  page > 1
                    ? "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    : "opacity-40 cursor-not-allowed"
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
              <Link
                href={page < totalPages ? getPageLink(page + 1) : "#"}
                className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors ${
                  page < totalPages
                    ? "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    : "opacity-40 cursor-not-allowed"
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
