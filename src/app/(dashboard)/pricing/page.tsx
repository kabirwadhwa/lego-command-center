import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import PricingManager from "@/components/PricingManager";

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
    
    // Calculate average acquisition cost
    const weightedCost = totalCompanyQty > 0
      ? companyBalances.reduce((sum, b) => sum + b.quantity * Number(b.averageCost), 0) / totalCompanyQty
      : 0;

    return {
      id: rec.id,
      recommendedPrice: Number(rec.recommendedPrice),
      reasoning: rec.reasoning,
      updatedAt: rec.updatedAt,
      variant: {
        id: variant.id,
        sku: variant.sku,
        condition: variant.condition,
        productName: variant.product.name,
        setNumber: variant.product.setNumber,
        cost: weightedCost,
        listings: variant.listings.map(l => ({
          id: l.id,
          marketplace: l.marketplace,
          price: Number(l.price),
        })),
      },
    };
  });

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-slate-950 text-white">
      {/* Title Header */}
      <div className="flex flex-col gap-1 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>🏷️</span> Pricing Recommendation Engine
        </h1>
        <p className="text-xs text-slate-400 font-medium">
          Optimize margins and competitive positioning. Accept recommended listings adjustments derived from live marketplace observations.
        </p>
      </div>

      <PricingManager
        initialRecommendations={mappedRecommendations}
        userRole={user.role}
      />
    </main>
  );
}
