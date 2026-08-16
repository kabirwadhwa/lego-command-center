"use server";

import { cookies } from "next/headers";
import { getAppMode, verifyDemoPassword } from "@/lib/auth";

/**
 * Authenticates the user for demo mode access using a password.
 */
export async function authenticateDemoAccessAction(password: string): Promise<{ success: boolean; error?: string }> {
  if (getAppMode() !== "demo") {
    return { success: false, error: "Access denied. Demo authentication is only available in DEMO mode." };
  }

  const isValid = verifyDemoPassword(password);
  if (!isValid) {
    return { success: false, error: "Incorrect password." };
  }

  const cookieStore = await cookies();
  cookieStore.set("demo_access_token", "true", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return { success: true };
}

/**
 * Server action to switch the active user in DEMO / development mode.
 * Throws an error in production or real mode.
 */
export async function switchDemoUser(userId: string): Promise<{ success: boolean; message: string }> {
  const appMode = getAppMode();
  
  if (appMode === "production") {
    throw new Error("Privilege switching is forbidden in production/real integration environments.");
  }

  if (appMode === "demo") {
    const cookieStore = await cookies();
    if (cookieStore.get("demo_access_token")?.value !== "true") {
      throw new Error("Demo access token required.");
    }
  }

  const allowedUserIds = [
    "44444444-4444-4444-4444-444444444444", // Kristof (ADMIN)
    "55555555-5555-5555-5555-555555555555", // Sabine (FAMILY_SELLER)
    "66666666-6666-6666-6666-666666666666", // Assistant (VIEWER)
  ];

  if (!allowedUserIds.includes(userId)) {
    return { success: false, message: "Invalid target user ID." };
  }

  const cookieStore = await cookies();
  cookieStore.set("lego_demo_user_id", userId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 1 week
  });

  return { success: true, message: "Demo user role successfully switched." };
}

/**
 * Clears the demo session cookie.
 */
export async function logoutDemoUser(): Promise<{ success: boolean }> {
  const cookieStore = await cookies();
  cookieStore.delete("lego_demo_user_id");
  cookieStore.delete("demo_access_token");
  return { success: true };
}
