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
import { getSessionUser, getCurrentUser, checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";

describe("Supabase Auth User Identity and Provisioning Tests", () => {
  const testUserUuid = "88888888-8888-8888-8888-888888888888";
  const testUserEmail = "auth-test@vervliet.be";
  let originalMode: string | undefined;
  let originalSupabaseUrl: string | undefined;
  let originalSupabaseKey: string | undefined;

  beforeAll(() => {
    originalMode = process.env.NEXT_PUBLIC_INTEGRATION_MODE;
    originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-supabase.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
  });

  afterAll(async () => {
    process.env.NEXT_PUBLIC_INTEGRATION_MODE = originalMode;
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
    process.env.NEXT_PUBLIC_INTEGRATION_MODE = originalMode;
  });

  test("Should return null in Demo mode if cookie points to a non-existent or inactive user", async () => {
    process.env.NEXT_PUBLIC_INTEGRATION_MODE = "DEMO";
    mockCookieGet.mockReturnValue({ value: "non-existent-user-id" });
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  test("Should auto-provision a profile if session exists in REAL mode but database record is missing", async () => {
    process.env.NEXT_PUBLIC_INTEGRATION_MODE = "REAL";
    
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

  test("Supabase Auth UUID = Application User.id Alignment", async () => {
    // Manually provision a user profile with the exact Supabase Auth UUID
    const createdUser = await prisma.user.create({
      data: {
        id: testUserUuid,
        email: testUserEmail,
        name: "Test User Identity",
        role: UserRole.FAMILY_SELLER,
        status: "ACTIVE",
      },
    });

    expect(createdUser.id).toBe(testUserUuid);

    // Mock session cookie to point to this UUID in DEMO mode
    process.env.NEXT_PUBLIC_INTEGRATION_MODE = "DEMO";
    mockCookieGet.mockReturnValue({ value: testUserUuid });

    const currentUser = await getCurrentUser();
    expect(currentUser).not.toBeNull();
    expect(currentUser?.id).toBe(testUserUuid);
    expect(currentUser?.email).toBe(testUserEmail);
    expect(currentUser?.role).toBe(UserRole.FAMILY_SELLER);
  });

  test("Role authorization guard checks", async () => {
    // Seed test profile
    await prisma.user.create({
      data: {
        id: testUserUuid,
        email: testUserEmail,
        name: "Test User Identity",
        role: UserRole.VIEWER,
        status: "ACTIVE",
      },
    });

    process.env.NEXT_PUBLIC_INTEGRATION_MODE = "DEMO";
    mockCookieGet.mockReturnValue({ value: testUserUuid });

    // 1. Permitted role access should succeed
    const authorizedUser = await checkRole([UserRole.VIEWER, UserRole.ADMIN]);
    expect(authorizedUser.id).toBe(testUserUuid);

    // 2. Mismatched role access should throw AuthError
    await expect(checkRole([UserRole.ADMIN])).rejects.toThrow(
      "You do not have permission to perform this action."
    );
  });
});
