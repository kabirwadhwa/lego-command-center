// Mock Next.js headers/cookies
const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    get: mockCookieGet,
    getAll: jest.fn(() => []),
  })),
}));

// Mock Supabase Server Client
jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn(async () => ({
        data: {
          user: {
            id: "88888888-8888-8888-8888-888888888888",
            email: "auth-test@vervliet.be",
          },
        },
        error: null,
      })),
    },
  })),
}));

import { prisma, pool } from "@/lib/prisma";
import { getCurrentUser, isDemoAuthEnabled, verifyDemoPassword, scryptHash } from "@/lib/auth";
import { switchDemoUser } from "@/app/actions/authActions";
import { UserRole } from "@prisma/client";

describe("Supabase Auth User Identity, Hardening & Security separation tests", () => {
  const testUserUuid = "88888888-8888-8888-8888-888888888888";
  const testUserEmail = "auth-test@vervliet.be";
  let originalAppMode: string | undefined;
  let originalDemoAuth: string | undefined;
  let originalSupabaseUrl: string | undefined;
  let originalSupabaseKey: string | undefined;

  beforeAll(() => {
    originalAppMode = process.env.APP_MODE;
    originalDemoAuth = process.env.ENABLE_DEMO_AUTH;
    originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-supabase.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
  });

  afterAll(async () => {
    process.env.APP_MODE = originalAppMode;
    process.env.ENABLE_DEMO_AUTH = originalDemoAuth;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseKey;

    await prisma.user.deleteMany({
      where: { id: testUserUuid },
    });
    await prisma.$disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: { id: testUserUuid },
    });
    mockCookieGet.mockReset();
    process.env.APP_MODE = "development";
    process.env.ENABLE_DEMO_AUTH = "false";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-supabase.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
  });

  test("Should return null in Demo appMode if cookies point to non-existent or inactive user", async () => {
    process.env.APP_MODE = "demo";
    mockCookieGet.mockImplementation((name) => {
      if (name === "demo_access_token") return { value: "true" };
      if (name === "lego_demo_user_id") return { value: "non-existent-user-id" };
      return null;
    });
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  test("Demo role switching is blocked when demo access token is missing", async () => {
    process.env.APP_MODE = "demo";
    mockCookieGet.mockImplementation((name) => {
      if (name === "demo_access_token") return null;
      return null;
    });

    await expect(switchDemoUser("44444444-4444-4444-4444-444444444444")).rejects.toThrow();
  });

  test("Demo mode access requires password cookie token", async () => {
    process.env.APP_MODE = "demo";
    mockCookieGet.mockImplementation((name) => {
      if (name === "demo_access_token") return null; // Missing
      if (name === "lego_demo_user_id") return { value: testUserUuid };
      return null;
    });
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  test("Production mode absolutely disables demo auth, ignores cookie switcher", async () => {
    process.env.APP_MODE = "production";
    process.env.ENABLE_DEMO_AUTH = "true"; // Attempt to bypass

    expect(isDemoAuthEnabled()).toBe(false);

    mockCookieGet.mockImplementation((name) => {
      if (name === "lego_demo_user_id") return { value: "44444444-4444-4444-4444-444444444444" };
      return null;
    });

    // Should verify Supabase getUser instead of cookie fallback
    const user = await getCurrentUser();
    expect(user?.id).toBe(testUserUuid); // resolved from mocked getUser()
  });

  test("Production mode fails closed when Supabase configuration is missing", async () => {
    process.env.APP_MODE = "production";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  test("Production mode blocks switchDemoUser server action", async () => {
    process.env.APP_MODE = "production";
    await expect(switchDemoUser("44444444-4444-4444-4444-444444444444")).rejects.toThrow(
      "Privilege switching is forbidden in production/real integration environments."
    );
  });

  test("Should auto-provision a profile if session exists in production mode but database record is missing", async () => {
    process.env.APP_MODE = "production";
    
    // Validate profile is missing initially
    const initialProfile = await prisma.user.findUnique({
      where: { id: testUserUuid },
    });
    expect(initialProfile).toBeNull();

    // getCurrentUser should auto-provision a profile linked to this UUID
    const currentUser = await getCurrentUser();
    expect(currentUser).not.toBeNull();
    expect(currentUser?.id).toBe(testUserUuid);
    expect(currentUser?.email).toBe(testUserEmail);
    expect(currentUser?.role).toBe(UserRole.VIEWER); // Default role

    // Verify it was persisted in database
    const dbProfile = await prisma.user.findUnique({
      where: { id: testUserUuid },
    });
    expect(dbProfile).not.toBeNull();
    expect(dbProfile?.id).toBe(testUserUuid);
    expect(dbProfile?.email).toBe(testUserEmail);
  });

  describe("Demo Password Hashing Scrypt Tests", () => {
    const password = "my-secret-password";
    let originalHash: string | undefined;

    beforeAll(() => {
      originalHash = process.env.DEMO_PASSWORD_HASH;
    });

    afterAll(() => {
      process.env.DEMO_PASSWORD_HASH = originalHash;
    });

    test("correct password succeeds", () => {
      process.env.DEMO_PASSWORD_HASH = scryptHash(password);
      expect(verifyDemoPassword(password)).toBe(true);
    });

    test("incorrect password fails", () => {
      process.env.DEMO_PASSWORD_HASH = scryptHash(password);
      expect(verifyDemoPassword("wrong-password")).toBe(false);
    });

    test("malformed stored hash fails closed", () => {
      process.env.DEMO_PASSWORD_HASH = "scrypt$invalid$format";
      expect(verifyDemoPassword(password)).toBe(false);

      process.env.DEMO_PASSWORD_HASH = "invalid_hash_value_without_dollars";
      expect(verifyDemoPassword(password)).toBe(false);
    });

    test("production mode cannot use demo password auth regardless of configuration", () => {
      process.env.APP_MODE = "production";
      process.env.ENABLE_DEMO_AUTH = "true";
      expect(isDemoAuthEnabled()).toBe(false);
    });
  });

  describe("Server-Side Authorization and Fail-Closed Role Enforcement", () => {
    const adminUserUuid = "11111111-1111-1111-1111-111111111111";
    const viewerUserUuid = "22222222-2222-2222-2222-222222222222";

    beforeAll(async () => {
      await prisma.user.upsert({
        where: { id: adminUserUuid },
        update: { role: UserRole.ADMIN, status: "ACTIVE" },
        create: {
          id: adminUserUuid,
          email: "admin-auth-test@vervliet.be",
          name: "Test Admin",
          role: UserRole.ADMIN,
          status: "ACTIVE",
        },
      });

      await prisma.user.upsert({
        where: { id: viewerUserUuid },
        update: { role: UserRole.VIEWER, status: "ACTIVE" },
        create: {
          id: viewerUserUuid,
          email: "viewer-auth-test@vervliet.be",
          name: "Test Viewer",
          role: UserRole.VIEWER,
          status: "ACTIVE",
        },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({
        where: { id: { in: [adminUserUuid, viewerUserUuid] } },
      });
    });

    test("anonymous user cannot execute inventory mutation (fails closed UNAUTHORIZED)", async () => {
      process.env.APP_MODE = "production";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const { checkRole, AuthError } = await import("@/lib/auth");
      await expect(checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER])).rejects.toThrow(AuthError);
      await expect(checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER])).rejects.toHaveProperty("code", "UNAUTHORIZED");
    });

    test("anonymous user cannot execute pricing mutation (fails closed UNAUTHORIZED)", async () => {
      process.env.APP_MODE = "production";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const { checkRole } = await import("@/lib/auth");
      await expect(checkRole([UserRole.ADMIN, UserRole.FAMILY_SELLER])).rejects.toThrow(
        "Authentication required. Please sign in."
      );
    });

    test("anonymous user cannot execute marketplace sync (fails closed UNAUTHORIZED)", async () => {
      process.env.APP_MODE = "production";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const { checkRole } = await import("@/lib/auth");
      await expect(checkRole([UserRole.ADMIN])).rejects.toThrow(
        "Authentication required. Please sign in."
      );
    });

    test("authenticated VIEWER cannot execute ADMIN action (fails closed FORBIDDEN)", async () => {
      process.env.APP_MODE = "development";
      mockCookieGet.mockImplementation((name) => {
        if (name === "lego_demo_user_id") return { value: viewerUserUuid };
        return null;
      });

      const { checkRole, AuthError } = await import("@/lib/auth");
      await expect(checkRole([UserRole.ADMIN])).rejects.toThrow(AuthError);
      await expect(checkRole([UserRole.ADMIN])).rejects.toHaveProperty("code", "FORBIDDEN");
    });

    test("authenticated ADMIN can execute allowed ADMIN action", async () => {
      process.env.APP_MODE = "development";
      mockCookieGet.mockImplementation((name) => {
        if (name === "lego_demo_user_id") return { value: adminUserUuid };
        return null;
      });

      const { checkRole } = await import("@/lib/auth");
      const user = await checkRole([UserRole.ADMIN]);
      expect(user).toBeDefined();
      expect(user.id).toBe(adminUserUuid);
      expect(user.role).toBe(UserRole.ADMIN);
    });

    test("database failure during auth lookup fails closed rather than granting ADMIN", async () => {
      process.env.APP_MODE = "development";
      mockCookieGet.mockImplementation((name) => {
        if (name === "lego_demo_user_id") return { value: adminUserUuid };
        return null;
      });

      const spy = jest.spyOn(prisma.user, "findUnique").mockRejectedValue(new Error("Database connection lost"));

      const { getCurrentUser, checkRole } = await import("@/lib/auth");
      const user = await getCurrentUser();
      expect(user).toBeNull(); // Must NOT return fallback Kristof ADMIN!

      await expect(checkRole([UserRole.ADMIN])).rejects.toThrow("Authentication required. Please sign in.");
      spy.mockRestore();
    });
  });
});

