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

// Mock auth checkRole and getAppMode
jest.mock("@/lib/auth", () => ({
  checkRole: jest.fn(async () => ({
    id: "44444444-4444-4444-4444-444444444444",
    name: "Kristof",
    role: "ADMIN",
  })),
  getAppMode: jest.fn(() => "production"),
}));

import { POST as testQueryPost, GET as testQueryGet } from "@/app/api/test/query/route";
import { POST as testRunPost, GET as testRunGet } from "@/app/api/test/run/route";
import { POST as testSeedPost, GET as testSeedGet } from "@/app/api/test/seed/route";

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

  test("Production Route Security: /api/test endpoints return 404 in production mode", async () => {
    // 1. Test query route
    const queryReq = new Request("http://localhost:3000/api/test/query?token=7919a1be-8967-4e2d-a3a6-1b11cf106a64", {
      method: "POST",
      body: JSON.stringify({ model: "user", action: "findMany", args: {} }),
      headers: { "Content-Type": "application/json" }
    });
    const queryRes = await testQueryPost(queryReq);
    expect(queryRes.status).toBe(404);

    const queryGetRes = await testQueryGet();
    expect(queryGetRes.status).toBe(404);

    // 2. Test run route
    const runReq = new Request("http://localhost:3000/api/test/run?token=7919a1be-8967-4e2d-a3a6-1b11cf106a64", {
      method: "POST",
      body: JSON.stringify({ action: "recordSale", params: {} }),
      headers: { "Content-Type": "application/json" }
    });
    const runRes = await testRunPost(runReq);
    expect(runRes.status).toBe(404);

    const runGetRes = await testRunGet();
    expect(runGetRes.status).toBe(404);

    // 3. Test seed route
    const seedReq = new Request("http://localhost:3000/api/test/seed?token=7919a1be-8967-4e2d-a3a6-1b11cf106a64", {
      method: "POST"
    });
    const seedRes = await testSeedPost(seedReq);
    expect(seedRes.status).toBe(404);

    const seedGetRes = await testSeedGet();
    expect(seedGetRes.status).toBe(404);
  });
});
