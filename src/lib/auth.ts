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
 * Gets the current authenticated session user from Supabase or simulated session cookies.
 * Does not check database roles directly, returns basic identification.
 */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  // Completely disable login gate and auto-login Kristof (ADMIN)
  return {
    id: "44444444-4444-4444-4444-444444444444", // Kristof's fixed seed UUID
    email: "kristof@vervliet.be",
  };
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
