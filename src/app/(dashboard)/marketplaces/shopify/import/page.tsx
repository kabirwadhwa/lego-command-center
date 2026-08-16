import prisma from "@/lib/prisma";
import { checkRole } from "@/lib/auth";
import { UserRole, MarketplaceType } from "@prisma/client";
import { MarketplaceFactory } from "@/services/marketplace/factory";
import { MarketplaceListing } from "@/services/marketplace/types";
import ShopifyImportWizard from "@/components/ShopifyImportWizard";

export const dynamic = "force-dynamic";

export default async function ShopifyImportPage() {
  // Validate administrator permission
  await checkRole([UserRole.ADMIN]);

  // Load target company accounts (e.g. Vervliet Enterprises)
  const companyAccounts = await prisma.inventoryAccount.findMany({
    where: { type: "COMPANY", status: "ACTIVE" },
    select: { id: true, name: true },
  });

  // Load existing products and variants to matching engine
  const existingProducts = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      setNumber: true,
      name: true,
      variants: {
        select: {
          id: true,
          sku: true,
          condition: true,
        },
      },
    },
  });

  // Instantiate the Shopify integration adapter
  const adapter = await MarketplaceFactory.getAdapter(MarketplaceType.SHOPIFY);
  
  let listings: MarketplaceListing[] = [];
  let errorMsg = null;

  try {
    listings = await adapter.getListings();
  } catch (err) {
    console.error("Failed to load Shopify listings:", err);
    errorMsg = err instanceof Error ? err.message : "Failed to load listings from Shopify.";
  }

  return (
    <main className="flex-1 p-8 overflow-y-auto bg-slate-950 text-white">
      {/* Title Header */}
      <div className="flex flex-col gap-1 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Shopify Initial Catalog Onboarding</h1>
        <p className="text-xs text-slate-400 font-medium">
          Import products, variants, and stock balances from Shopify into the central LEGO Command Center.
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
        <ShopifyImportWizard
          listings={listings}
          existingProducts={existingProducts}
          companyAccounts={companyAccounts}
        />
      )}
    </main>
  );
}
