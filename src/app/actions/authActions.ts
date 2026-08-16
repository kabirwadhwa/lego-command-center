"use server";

import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/auth";

/**
 * Server action to switch the active user in DEMO / development mode.
 * Throws an error in production or real mode.
 */
export async function switchDemoUser(userId: string): Promise<{ success: boolean; message: string }> {
  // Security Guard: Prevent privilege switching in production or real mode
  if (!isDemoMode()) {
    throw new Error("Privilege switching is forbidden in production/real integration environments.");
  }

  // Validate that the target userId is one of our seeded users to prevent arbitrary inputs
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
  return { success: true };
}
