import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import AlertsManager from "@/components/AlertsManager";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  // Validate that the user is authenticated (Viewer roles and above can read alerts)
  await checkRole([UserRole.VIEWER, UserRole.FAMILY_SELLER, UserRole.ADMIN]);

  // Load unresolved alerts
  const unresolvedAlerts = await prisma.alert.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" },
  });

  // Load active product variants for resolution mappings
  const catalogVariants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      sku: true,
      condition: true,
      product: {
        select: {
          name: true,
          setNumber: true,
        },
      },
    },
    orderBy: { sku: "asc" },
  });

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-slate-950 text-white">
      {/* Title Header */}
      <div className="flex flex-col gap-1 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white font-sans flex items-center gap-2">
          <span>⚠️</span> Operational Alerts
        </h1>
        <p className="text-xs text-slate-400 font-medium">
          Monitor system discrepancies, unmatched marketplace listings, low stock levels, and integration errors.
        </p>
      </div>

      <AlertsManager
        initialAlerts={unresolvedAlerts}
        catalogVariants={catalogVariants}
      />
    </main>
  );
}
