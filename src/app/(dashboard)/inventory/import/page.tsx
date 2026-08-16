import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import ImportWizard from "@/components/ImportWizard";

export default async function InventoryImportPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Fetch active inventory accounts (Vervliet Enterprises, Stock X)
  const accounts = await prisma.inventoryAccount.findMany({
    where: { status: "ACTIVE" },
  });

  return (
    <div className="space-y-8 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          CSV Bulk Inventory Import
        </h1>
        <p className="text-slate-500 text-xs mt-1.5 font-medium">
          Upload Shopify lists or custom stock spreadsheets, map source headers to database fields, and bulk ingest items.
        </p>
      </div>

      <ImportWizard accounts={accounts} />
    </div>
  );
}
