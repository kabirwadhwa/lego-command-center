import "dotenv/config";
import { PrismaClient, MarketplaceType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface ShopifyShop {
  id: string;
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  email: string;
  plan?: { displayName: string };
}

interface ShopifyLocation {
  id: string;
  name: string;
  isActive: boolean;
  isPrimary: boolean;
}

interface ShopifyVariant {
  id: string;
  sku: string;
  price: string;
  inventoryItem?: { id: string };
}

interface ShopifyProduct {
  id: string;
  title: string;
  variants: { edges: Array<{ node: ShopifyVariant }> };
}

async function executeShopifyGraphQL<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const cleanShop = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${cleanShop}/admin/api/2026-07/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify API responded with HTTP ${response.status}: ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors && json.errors.length > 0) {
    const errorDetails = json.errors.map((e: { message: string }) => e.message).join("; ");
    throw new Error(`Shopify GraphQL Error: ${errorDetails}`);
  }

  return json.data as T;
}

export async function verifyShopifyIntegration(): Promise<{
  success: boolean;
  configured: boolean;
  summary?: Record<string, unknown>;
  error?: string;
}> {
  console.log("==================================================");
  console.log("   SHOPIFY INTEGRATION READ-ONLY VERIFICATION     ");
  console.log("==================================================");

  // 1. Resolve credentials from DB and Environment
  const marketplace = await prisma.marketplace.findUnique({
    where: { id: MarketplaceType.SHOPIFY },
  });

  let shopDomain = process.env.SHOPIFY_STORE_DOMAIN || "";
  let accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "";
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || "";

  if (marketplace?.credentialsJson) {
    try {
      const parsed = JSON.parse(marketplace.credentialsJson);
      if (parsed.shopName && !shopDomain) shopDomain = parsed.shopName;
      if (parsed.accessToken && !accessToken) accessToken = parsed.accessToken;
    } catch {
      console.warn("⚠️  Unable to parse Marketplace credentials JSON from DB.");
    }
  }

  console.log(`- Configured Mode:       ${marketplace?.mode || "NOT_FOUND"}`);
  console.log(`- Store Domain:          ${shopDomain ? shopDomain : "(Not Configured)"}`);
  console.log(`- Access Token Present:  ${accessToken ? "YES (redacted)" : "NO"}`);
  console.log(`- Webhook Secret Present:${webhookSecret ? "YES (redacted)" : "NO"}`);

  if (!shopDomain || !accessToken) {
    console.log("\n⚠️  Shopify integration is NOT CONFIGURED for live verification.");
    console.log("To verify live connection, provide SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.");
    return {
      success: true,
      configured: false,
      summary: {
        mode: marketplace?.mode || "UNCONFIGURED",
        configured: false,
        message: "Missing live Shopify credentials. System remains safely in DEMO/unconfigured mode.",
      },
    };
  }

  try {
    // 2. Fetch Shop Details
    console.log("\n📡 1. Authenticating & Fetching Shop Information...");
    const shopQuery = `
      query getShopInfo {
        shop {
          id
          name
          myshopifyDomain
          currencyCode
          email
          plan {
            displayName
          }
        }
      }
    `;
    const shopData = await executeShopifyGraphQL<{ shop: ShopifyShop }>(shopDomain, accessToken, shopQuery);
    const shop = shopData.shop;
    console.log(`   ✓ Connected to Shop: ${shop.name} (${shop.myshopifyDomain})`);
    console.log(`   ✓ Currency: ${shop.currencyCode}, Plan: ${shop.plan?.displayName || "N/A"}`);

    // 3. Fetch Locations
    console.log("\n📡 2. Verifying Fulfillment Locations...");
    const locQuery = `
      query getLocations {
        locations(first: 5) {
          edges {
            node {
              id
              name
              isActive
              isPrimary
            }
          }
        }
      }
    `;
    const locData = await executeShopifyGraphQL<{ locations: { edges: Array<{ node: ShopifyLocation }> } }>(
      shopDomain,
      accessToken,
      locQuery
    );
    const locations = locData.locations.edges.map(e => e.node);
    console.log(`   ✓ Retrieved ${locations.length} location(s):`);
    for (const loc of locations) {
      console.log(`     - [${loc.isActive ? "ACTIVE" : "INACTIVE"}] ${loc.name} (${loc.id}) ${loc.isPrimary ? "(Primary)" : ""}`);
    }

    // 4. Fetch Small Product Sample (Read-Only)
    console.log("\n📡 3. Querying Product & Variant Sample (Up to 5)...");
    const prodQuery = `
      query getSampleProducts {
        products(first: 5) {
          edges {
            node {
              id
              title
              variants(first: 5) {
                edges {
                  node {
                    id
                    sku
                    price
                    inventoryItem {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const prodData = await executeShopifyGraphQL<{ products: { edges: Array<{ node: ShopifyProduct }> } }>(
      shopDomain,
      accessToken,
      prodQuery
    );
    const products = prodData.products.edges.map(e => e.node);
    console.log(`   ✓ Retrieved ${products.length} product(s) from Shopify.`);

    // 5. Test Catalog SKU Mappings against Local DB
    console.log("\n🔍 4. Resolving Catalog Mappings against Local Database...");
    let matchedCount = 0;
    let totalVariants = 0;

    for (const p of products) {
      const variants = p.variants.edges.map(e => e.node);
      for (const v of variants) {
        totalVariants++;
        const sku = v.sku?.trim();
        let localMatch = null;
        if (sku) {
          localMatch = await prisma.productVariant.findFirst({
            where: { sku },
            include: { product: true },
          });
        }

        if (localMatch) {
          matchedCount++;
          console.log(`   ✓ SKU [${sku}]: MATCHED to ${localMatch.product.name} (Set ${localMatch.product.setNumber})`);
        } else {
          console.log(`   - SKU [${sku || "NO_SKU"}]: No local variant found in database.`);
        }
      }
    }

    console.log("\n==================================================");
    console.log("   READ-ONLY VERIFICATION COMPLETE: ALL CHECKS PASSED");
    console.log(`   Shop: ${shop.name} | Locations: ${locations.length} | Sampled: ${totalVariants} variants (${matchedCount} mapped)`);
    console.log("==================================================");

    return {
      success: true,
      configured: true,
      summary: {
        shopName: shop.name,
        domain: shop.myshopifyDomain,
        currency: shop.currencyCode,
        activeLocations: locations.filter(l => l.isActive).length,
        sampledVariants: totalVariants,
        mappedVariants: matchedCount,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ VERIFICATION FAILED: ${errorMsg}`);
    return {
      success: false,
      configured: true,
      error: errorMsg,
    };
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  verifyShopifyIntegration().then(res => {
    if (!res.success) {
      process.exit(1);
    }
  });
}
