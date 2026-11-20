import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import PricingManager from "@/components/PricingManager";
import LotAnalyzer from "@/components/pricing/LotAnalyzer";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  // Resolve authenticated user profile (all users with Viewer roles and above can access pricing data)
  const user = await checkRole([UserRole.VIEWER, UserRole.FAMILY_SELLER, UserRole.ADMIN]);

  // Load all active price recommendations
  const recommendations = await prisma.priceRecommendation.findMany({
    include: {
      productVariant: {
        include: {
          product: true,
          listings: true,
          balances: {
            where: {
              inventoryAccount: { type: "COMPANY" },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Map to client format
  const mappedRecommendations = recommendations.map((rec) => {
    const variant = rec.productVariant;
    const companyBalances = variant.balances;
    const totalCompanyQty = companyBalances.reduce((sum, b) => sum + b.quantity, 0);
    const totalKnownCostTotal = companyBalances.reduce((sum, b) => sum + Number(b.knownCostTotal), 0);
    const totalKnownQty = companyBalances.reduce((sum, b) => sum + b.knownCostQuantity, 0);

    const cost: number | null = totalKnownQty > 0
      ? Math.round((totalKnownCostTotal / totalKnownQty) * 100) / 100
      : null;

    let costBasisStatus: "FULLY_KNOWN" | "PARTIALLY_KNOWN" | "COMPLETELY_UNKNOWN" = "COMPLETELY_UNKNOWN";
    if (totalKnownQty >= totalCompanyQty && totalCompanyQty > 0) {
      costBasisStatus = "FULLY_KNOWN";
    } else if (totalKnownQty > 0) {
      costBasisStatus = "PARTIALLY_KNOWN";
    }

    return {
      id: rec.id,
      recommendedPrice: Number(rec.recommendedPrice),
      reasoning: rec.reasoning,
      confidenceScore: rec.confidenceScore,
      confidenceTier: rec.confidenceTier,
      observationCount: rec.observationCount,
      marketMedian: rec.marketMedian ? Number(rec.marketMedian) : null,
      marketMin: rec.marketMin ? Number(rec.marketMin) : null,
      marketMax: rec.marketMax ? Number(rec.marketMax) : null,
      evidenceUpdatedAt: rec.evidenceUpdatedAt,
      updatedAt: rec.updatedAt,
      variant: {
        id: variant.id,
        sku: variant.sku,
        condition: variant.condition,
        productName: variant.product.name,
        setNumber: variant.product.setNumber,
        cost,
        costBasisStatus,
        listings: variant.listings.map(l => ({
          id: l.id,
          marketplace: l.marketplace,
          price: Number(l.price),
        })),
      },
    };
  });

  // Load recent LEGO market research history
  const { MarketResearchService } = await import("@/services/pricing/marketResearchService");
  const recentResearches = await MarketResearchService.getRecentResearches(6);

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-slate-950 text-white">
      {/* Title Header */}
      <div className="flex flex-col gap-1 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>🏷️</span> Pricing Analysis Engine
        </h1>
        <p className="text-xs text-slate-400 font-medium">
          Paste or upload a list of sets and get RRP, retirement status, current value and
          profit against what was paid — per set and for the lot as a whole.
        </p>
      </div>

      <LotAnalyzer />

      {/* The per-channel recommendation engine, unchanged. Collapsed so the
          bulk analysis above is the default view. */}
      <details className="mt-10 rounded-xl border border-slate-800 bg-slate-900/40">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-white">
          Per-channel listing recommendations
          <span className="ml-2 font-normal text-slate-400">
            — breakeven floors and suggested prices per marketplace, including selling fees
          </span>
        </summary>
        <div className="border-t border-slate-800 p-5">
          <PricingManager
            initialRecommendations={mappedRecommendations}
            initialRecentResearches={recentResearches}
            userRole={user.role}
          />
        </div>
      </details>
    </main>
  );
}
