import { prisma } from "@/lib/prisma";
import { ShopifyAdapter } from "@/services/marketplace/shopify";
import { CatawikiAdapter } from "@/services/marketplace/catawiki";
import { BolAdapter } from "@/services/marketplace/bol";

describe("Antigravity LEGO Command Center Smoke Tests", () => {
  test("Database Connection: Can query users from database", async () => {
    const userCount = await prisma.user.count();
    expect(userCount).toBeGreaterThanOrEqual(0);
    console.log(`✅ [Smoke Test - DB Connection]: Found ${userCount} users.`);
  });

  test("Database Reads: Can query products and stock balances", async () => {
    const products = await prisma.product.findMany({ take: 5 });
    const balances = await prisma.inventoryBalance.findMany({ take: 5 });
    expect(Array.isArray(products)).toBe(true);
    expect(Array.isArray(balances)).toBe(true);
    console.log(`✅ [Smoke Test - Database Reads]: Retrieved ${products.length} products and ${balances.length} balances.`);
  });

  test("Shopify Adapter: Can instantiate and execute connection check in DEMO mode", async () => {
    const adapter = new ShopifyAdapter("DEMO");
    const connectionTest = await adapter.testConnection();
    expect(connectionTest.success).toBe(true);
    console.log("✅ [Smoke Test - Shopify Adapter]: Connection test passed.");
  });

  test("Catawiki Adapter: Can instantiate and check capabilities in DEMO mode", async () => {
    const adapter = new CatawikiAdapter("DEMO");
    const connectionTest = await adapter.testConnection();
    expect(connectionTest.success).toBe(true);
    const capabilities = adapter.getCapabilities();
    expect(capabilities.orders).toBe("AVAILABLE");
    console.log("✅ [Smoke Test - Catawiki Adapter]: Capabilities verified.");
  });

  test("Bol Adapter: Can instantiate and check capabilities in DEMO mode", async () => {
    const adapter = new BolAdapter("DEMO");
    const connectionTest = await adapter.testConnection();
    expect(connectionTest.success).toBe(true);
    const capabilities = adapter.getCapabilities();
    expect(capabilities.orders).toBe("AVAILABLE");
    console.log("✅ [Smoke Test - Bol Adapter]: Capabilities verified.");
  });

  test("Seed Database Consistency: Active COMPANY inventory account is present", async () => {
    const companyAcc = await prisma.inventoryAccount.findFirst({
      where: { type: "COMPANY", status: "ACTIVE" }
    });
    expect(companyAcc).not.toBeNull();
    console.log(`✅ [Smoke Test - Database Seeds]: Active COMPANY account present with ID: ${companyAcc?.id}`);
  });
});
