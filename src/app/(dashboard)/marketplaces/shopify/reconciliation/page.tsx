import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole, MarketplaceType } from "@prisma/client";
import { MarketplaceFactory } from "@/services/marketplace/factory";
import { MarketplaceListing } from "@/services/marketplace/types";
import ShopifyReconciliation from "@/components/ShopifyReconciliation";

export const dynamic = "force-dynamic";

export default async function ShopifyReconciliationPage() {
  // Validate administrator permission
  await checkRole([UserRole.ADMIN]);

  // Load the Shopify integration adapter
  const adapter = await MarketplaceFactory.getAdapter(MarketplaceType.SHOPIFY);
  
  let shopifyListings: MarketplaceListing[] = [];
  let errorMsg = null;

  try {
    shopifyListings = await adapter.getListings();
  } catch (err) {
    console.error("Failed to fetch Shopify listings for reconciliation:", err);
    errorMsg = err instanceof Error ? err.message : "Failed to load listings from Shopify.";
  }

  // Compile discrepancies
  const discrepancies = [];

  if (!errorMsg) {
    // Load all active catalog variants in local db
    const activeVariants = await prisma.productVariant.findMany({
      where: { status: "ACTIVE" },
      include: {
        product: true,
        balances: {
          where: {
            inventoryAccount: { type: "COMPANY" },
          },
        },
      },
    });

    for (const listing of shopifyListings) {
      // Find matching variant
      const variant = activeVariants.find(v => v.sku.toLowerCase() === listing.sku.toLowerCase());
      
      if (variant) {
        // Calculate authoritative company stock quantity
        const centralQty = variant.balances.reduce((sum, b) => sum + b.quantity, 0);
        const shopifyQty = listing.quantity;
        const diff = shopifyQty - centralQty;

        if (diff !== 0) {
          discrepancies.push({
            productVariantId: variant.id,
            sku: variant.sku,
            productName: variant.product.name,
            setNumber: variant.product.setNumber,
            centralQty,
            shopifyQty,
            diff,
          });
        }
      }
    }
  }

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-slate-950 text-white">
      {/* Title Header */}
      <div className="flex flex-col gap-1 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>⚖️</span> Shopify Inventory Reconciliation
        </h1>
        <p className="text-xs text-slate-400 font-medium">
          Identify stock discrepancies between local double-entry records and remote Shopify listings. Push central counts or correct local stock.
        </p>
      </div>

      {errorMsg ? (
        <div className="max-w-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 p-6 rounded-xl text-xs font-bold space-y-4">
          <p>✗ Error connecting to Shopify: {errorMsg}</p>
          <p className="text-slate-400 font-medium">
            Please make sure that the Shopify integration is configured correctly in settings and mode is either DEMO or REAL with valid API credentials.
          </p>
        </div>
      ) : (
        <ShopifyReconciliation discrepancies={discrepancies} />
      )}
    </main>
  );
}
