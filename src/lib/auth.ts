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
 * Helper to determine current application environment mode.
 * Defaults to "production" if unconfigured or invalid.
 */
export function getAppMode(): "development" | "demo" | "production" {
  const mode = process.env.APP_MODE;
  if (mode === "development" || mode === "demo" || mode === "production") {
    return mode;
  }
  return "production";
}

/**
 * Returns true only if demo authentication is explicitly enabled in a non-production mode.
 */
export function isDemoAuthEnabled(): boolean {
  if (getAppMode() === "production") {
    return false;
  }
  return process.env.ENABLE_DEMO_AUTH === "true";
}

export function scryptHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$16384$8$1$${salt}$${derivedKey}`;
}

export function verifyDemoPassword(password: string): boolean {
  const hash = process.env.DEMO_PASSWORD_HASH;
  if (!hash) return false;

  try {
    const parts = hash.split("$");
    if (parts.length !== 6) return false;
    const [algorithm, nStr, rStr, pStr, salt, derivedKeyHex] = parts;
    if (algorithm !== "scrypt") return false;

    const N = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);

    const keyBuffer = Buffer.from(derivedKeyHex, "hex");
    const testKey = crypto.scryptSync(password, salt, keyBuffer.length, { N, r, p });

    return crypto.timingSafeEqual(keyBuffer, testKey);
  } catch {
    return false; // fail closed
  }
}

export function isDemoMode(): boolean {
  return getAppMode() !== "production";
}

/**
 * Gets the current authenticated session user.
 * Strictly fails closed: returns null if unauthenticated, invalid, or missing.
 * Zero production auto-login or bypass behavior.
 */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const appMode = getAppMode();

  // 1. Production Mode: Strictly use Supabase Auth
  if (appMode === "production") {
    try {
      const cookieStore = await cookies();
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        return null; // Fail closed if auth credentials are missing
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
        return null; // Fail closed on auth error or missing session
      }

      return {
        id: user.id,
        email: user.email ?? ""
      };
    } catch {
      return null; // Fail closed
    }
  }

  // 2. Demo Mode: Only permitted when APP_MODE="demo" AND ENABLE_DEMO_AUTH="true"
  if (appMode === "demo") {
    if (!isDemoAuthEnabled()) {
      return null;
    }

    try {
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
        return null; // Fail closed
      }

      return {
        id: user.id,
        email: user.email
      };
    } catch {
      return null; // Fail closed
    }
  }

  // 3. Development Mode: Requires explicit demo cookie pointing to a valid active user in DB
  if (appMode === "development") {
    try {
      const cookieStore = await cookies();
      const activeUserId = cookieStore.get("lego_demo_user_id")?.value;

      if (!activeUserId) {
        return null; // Fail closed: unauthenticated user must sign in
      }

      const user = await prisma.user.findUnique({
        where: { id: activeUserId }
      });

      if (!user || user.status !== "ACTIVE") {
        return null; // Fail closed
      }

      return {
        id: user.id,
        email: user.email
      };
    } catch {
      return null; // Fail closed
    }
  }

  return null;
}

/**
 * Resolves the authenticated user session to an application profile.
 * Fetches the user role and details from the database.
 * Strictly fails closed on DB error or missing/inactive user.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  let sessionUser: { id: string; email: string } | null = null;
  try {
    sessionUser = await getSessionUser();
  } catch {
    return null; // Fail closed
  }

  if (!sessionUser) return null;

  try {
    let profile = await prisma.user.findUnique({
      where: { id: sessionUser.id }
    });

    // Auto-provision profile on first authentication only if not found
    // Default role is strictly VIEWER (never ADMIN)
    if (!profile) {
      profile = await prisma.user.create({
        data: {
          id: sessionUser.id,
          email: sessionUser.email,
          name: sessionUser.email ? sessionUser.email.split("@")[0] : "New User",
          role: UserRole.VIEWER,
          status: "ACTIVE"
        }
      });
    }

    if (profile.status !== "ACTIVE") {
      return null; // Fail closed for inactive/suspended accounts
    }

    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      status: profile.status,
    };
  } catch {
    // Strictly fail closed if database is unreachable; NEVER grant admin access
    return null;
  }
}

/**
 * Server-side guard to verify active role permissions.
 * Throws typed errors if authentication or authorization fails.
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
