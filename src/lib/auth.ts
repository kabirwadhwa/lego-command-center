import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { UserRole } from "@prisma/client";
import prisma from "./prisma";

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
export function isDemoMode(): boolean {
  return !process.env.NEXT_PUBLIC_INTEGRATION_MODE || process.env.NEXT_PUBLIC_INTEGRATION_MODE === "DEMO";
}

/**
 * Gets the current authenticated session user from Supabase or simulated session cookies.
 * Does not check database roles directly, returns basic identification.
 */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const isDemo = isDemoMode();

  if (isDemo) {
    // In demo mode, look for the local session cookie
    const cookieStore = await cookies();
    const activeUserId = cookieStore.get("lego_demo_user_id")?.value;

    if (!activeUserId) {
      // Default to admin user in development if no cookie is set, to ensure first-run onboarding is frictionless
      return {
        id: "44444444-4444-4444-4444-444444444444", // Kristof's fixed seed UUID
        email: "kristof@vervliet.be",
      };
    }

    // Resolve the user from database using the cookie id
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

  // In REAL mode, fetch using Supabase Client
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AuthError("CONFIGURATION_ERROR", "Supabase credentials are missing.");
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
          } catch {
            // Server actions or route handlers might ignore setting cookies on read-only requests
          }
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

/**
 * Resolves the authenticated user session to exactly one application profile.
 * Fetches the user role and details from the database.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  const profile = await prisma.user.findUnique({
    where: { id: sessionUser.id }
  });

  if (!profile || profile.status !== "ACTIVE") {
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
