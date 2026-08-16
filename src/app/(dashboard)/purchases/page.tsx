import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import PurchaseForm from "@/components/PurchaseForm";
import { ShoppingBag, Calendar } from "lucide-react";

export default async function PurchasesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 1. Fetch active variants to choose from
  const variants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    include: { product: true },
    orderBy: { sku: "asc" },
  });

  // 2. Fetch inventory accounts (Vervliet Enterprises, Stock X)
  const accounts = await prisma.inventoryAccount.findMany({
    where: { status: "ACTIVE" },
  });

  // 3. Fetch past purchase invoice intakes
  const purchases = await prisma.purchase.findMany({
    orderBy: { purchaseDate: "desc" },
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
    <div className="space-y-8 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Purchase & Stock Intake
        </h1>
        <p className="text-slate-500 text-xs mt-1.5 font-medium">
          Log wholesale acquisitions, configure moving average cost metrics, and view past purchase histories.
        </p>
      </div>

      {/* Main Grid View split (Left side past list, Right side intake form) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side: Past Purchases (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight">
                Wholesale Intake Invoice History
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchases.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-400 font-semibold select-none">
                  No purchase intakes logged yet.
                </div>
              ) : (
                purchases.map((pur) => (
                  <div key={pur.id} className="p-6 space-y-4">
                    <div className="flex justify-between items-start text-xs font-semibold">
                      <div className="space-y-1.5">
                        <span className="font-bold text-slate-900 dark:text-white text-sm">
                          {pur.supplier}
                        </span>
                        <div className="flex items-center gap-4 text-[10px] text-slate-400 uppercase tracking-wide">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(pur.purchaseDate).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <ShoppingBag className="w-3.5 h-3.5" />
                            {pur.items.reduce((sum, item) => sum + item.quantity, 0)} units
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-slate-950 dark:text-white text-sm block">
                          {fmt(pur.totalCost)}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 mt-1 select-none">
                          {pur.status}
                        </span>
                      </div>
                    </div>

                    {/* Nested Purchase Items */}
                    <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-850 rounded-lg p-3.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400 space-y-2.5">
                      {pur.items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center">
                          <div className="min-w-0 pr-4">
                            <span className="text-slate-800 dark:text-slate-200 font-bold block truncate">
                              {item.productVariant.product.setNumber} - {item.productVariant.product.name}
                            </span>
                            <span className="text-[9px] text-slate-400 font-medium block mt-0.5">
                              SKU: {item.productVariant.sku} • Account: {item.inventoryAccount.name}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-slate-900 dark:text-white font-bold block">
                              {item.quantity} x {fmt(item.unitCost)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {pur.notes && (
                      <p className="text-[10px] text-slate-400 font-medium italic mt-2">
                        &ldquo;{pur.notes}&rdquo;
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Intake Form (1/3 width) */}
        <div>
          <PurchaseForm variants={variants} accounts={accounts} />
        </div>
      </div>
    </div>
  );
}
