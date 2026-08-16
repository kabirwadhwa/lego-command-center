import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { UserRole } from "@prisma/client";
import prisma from "./prisma";
import crypto from "crypto";

// Custom typed domain errors
export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: string;
}

/**
 * Helper to determine if we are in DEMO mode.
 * Falls back to true if NEXT_PUBLIC_INTEGRATION_MODE is not set or set to "DEMO".
 */
export function getAppMode(): "development" | "demo" | "production" {
  const mode = process.env.APP_MODE;
  if (mode === "development" || mode === "demo" || mode === "production") {
    return mode;
  }
  return "production";
}

export function isDemoAuthEnabled(): boolean {
  if (getAppMode() === "production") {
    return false;
  }
  return process.env.ENABLE_DEMO_AUTH === "true";
}

export function verifyDemoPassword(password: string): boolean {
  const hash = process.env.DEMO_PASSWORD_HASH;
  if (!hash || hash.length !== 64) return false;
  try {
    const computed = crypto.createHash("sha256").update(password).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function isDemoMode(): boolean {
  return getAppMode() !== "production";
}

/**
 * Gets the current authenticated session user from Supabase or simulated session cookies.
 * Does not check database roles directly, returns basic identification.
 */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const appMode = getAppMode();

  if (appMode === "production") {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      // Fail closed secure fallback
      return null;
    }

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch {}
          },
        },
      }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email ?? ""
    };
  }

  if (appMode === "demo") {
    const cookieStore = await cookies();
    const hasDemoAccess = cookieStore.get("demo_access_token")?.value === "true";
    if (!hasDemoAccess) {
      return null;
    }

    const activeUserId = cookieStore.get("lego_demo_user_id")?.value;
    if (!activeUserId) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: activeUserId }
    });

    if (!user || user.status !== "ACTIVE") {
      return null;
    }

    return {
      id: user.id,
      email: user.email
    };
  }

  // Development mode fallback
  if (appMode === "development") {
    const cookieStore = await cookies();
    const activeUserId = cookieStore.get("lego_demo_user_id")?.value;

    if (!activeUserId) {
      return {
        id: "44444444-4444-4444-4444-444444444444", // Kristof's fixed seed UUID
        email: "kristof@vervliet.be",
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: activeUserId }
    });

    if (!user || user.status !== "ACTIVE") {
      return null;
    }

    return {
      id: user.id,
      email: user.email
    };
  }

  return null;
}

/**
 * Resolves the authenticated user session to exactly one application profile.
 * Fetches the user role and details from the database.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  let profile = await prisma.user.findUnique({
    where: { id: sessionUser.id }
  });

  // Auto-provision profile on first authentication
  if (!profile) {
    profile = await prisma.user.create({
      data: {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.email.split("@")[0] || "New User",
        role: UserRole.VIEWER, // Fallback default role
        status: "ACTIVE"
      }
    });
  }

  if (profile.status !== "ACTIVE") {
    return null;
  }

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role,
    status: profile.status,
  };
}

/**
 * Server-side guard to verify active role permissions.
 * Throws typed errors if authorization fails.
 */
export async function checkRole(allowedRoles: UserRole[]): Promise<AuthUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthError("UNAUTHORIZED", "Authentication required. Please sign in.");
  }

  if (!allowedRoles.includes(user.role)) {
    throw new AuthError("FORBIDDEN", "You do not have permission to perform this action.");
  }

  return user;
}
