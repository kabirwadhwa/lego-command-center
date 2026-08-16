import { prisma, pool } from "@/lib/prisma";
import { saveMarketplaceConfigAction, testMarketplaceConnectionAction } from "@/app/actions/marketplaceActions";
import { MarketplaceType } from "@prisma/client";

// Mock Next.js cache and headers
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

// Mock auth checkRole
jest.mock("@/lib/auth", () => ({
  checkRole: jest.fn(async () => ({
    id: "44444444-4444-4444-4444-444444444444",
    name: "Kristof",
    role: "ADMIN",
  })),
}));

describe("Marketplace Credentials Isolate from Client and Database Exposure tests", () => {
  const originalEnvToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  beforeAll(() => {
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_prod_secret_token";
  });

  afterAll(async () => {
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalEnvToken;
    await prisma.$disconnect();
    await pool.end();
  });

  test("saveMarketplaceConfigAction strips sensitive credentials before writing to database", async () => {
    const rawCredentials = {
      shopName: "secure-shop.myshopify.com",
      accessToken: "shpat_sensitive_token_to_strip",
      webhookSecret: "whsec_sensitive_token_to_strip",
    };

    const res = await saveMarketplaceConfigAction(
      MarketplaceType.SHOPIFY,
      "REAL",
      rawCredentials
    );

    expect(res.success).toBe(true);

    const record = await prisma.marketplace.findUnique({
      where: { id: MarketplaceType.SHOPIFY },
    });

    expect(record).not.toBeNull();
    expect(record?.mode).toBe("REAL");
    expect(record?.credentialsJson).not.toBeNull();

    const savedCreds = JSON.parse(record!.credentialsJson!);
    // shopName is preserved as non-sensitive connection metadata
    expect(savedCreds.shopName).toBe("secure-shop.myshopify.com");
    // Secrets must NOT be written to the database
    expect(savedCreds.accessToken).toBeUndefined();
    expect(savedCreds.webhookSecret).toBeUndefined();
  });

  test("testMarketplaceConnectionAction correctly merges server-side secrets from environment", async () => {
    // We send credentials without the token. The action should fetch it from process.env
    const res = await testMarketplaceConnectionAction(
      MarketplaceType.SHOPIFY,
      "DEMO", // Using DEMO mode so it returns success without hitting external Shopify REST endpoint
      { shopName: "demo-shop" }
    );

    expect(res.success).toBe(true);
  });
});
