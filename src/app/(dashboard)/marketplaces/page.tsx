import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import MarketplaceManager from "@/components/MarketplaceManager";

export const dynamic = "force-dynamic";

export default async function MarketplacesPage() {
  // Validate that the user is an administrator
  await checkRole([UserRole.ADMIN]);

  // Load all seeded marketplace configurations
  const dbMarketplaces = await prisma.marketplace.findMany({
    orderBy: { id: "asc" },
  });

  const clientMarketplaces = dbMarketplaces.map((m) => {
    const cleanCredentials: Record<string, string> = {};
    if (m.credentialsJson) {
      try {
        const parsed = JSON.parse(m.credentialsJson);
        // Only permit safe, non-sensitive connection identifiers to reach the browser DTO
        if (parsed.shopName) cleanCredentials.shopName = parsed.shopName;
        if (parsed.clientId) cleanCredentials.clientId = parsed.clientId;
      } catch {}
    }

    return {
      id: m.id,
      name: m.name,
      status: m.status,
      mode: m.mode,
      credentialsJson: Object.keys(cleanCredentials).length > 0 ? JSON.stringify(cleanCredentials) : null,
      lastSyncedAt: m.lastSyncedAt,
    };
  });

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-slate-950 text-white">
      {/* Title Header */}
      <div className="flex flex-col gap-1 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Marketplace Connections</h1>
        <p className="text-xs text-slate-400 font-medium">
          Manage integrations, configure credential tokens, and track real-time sync jobs status.
        </p>
      </div>

      {/* Grid of integrations */}
      <MarketplaceManager initialMarketplaces={clientMarketplaces} />
    </main>
  );
}
