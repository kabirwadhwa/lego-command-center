import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAppMode, verifyDemoPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let action = "";
    let password = "";
    let userId = "";

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      action = formData.get("action") as string;
      password = formData.get("password") as string;
      userId = formData.get("userId") as string;
    } else {
      const body = await request.json();
      action = body.action;
      password = body.password;
      userId = body.userId;
    }

    const appMode = getAppMode();
    if (appMode === "production") {
      return NextResponse.redirect(new URL("/login?error=forbidden_in_production", request.url));
    }

    if (action === "verify-password") {
      if (!password) {
        return NextResponse.redirect(new URL("/login?error=missing_password", request.url));
      }

      const isValid = verifyDemoPassword(password);
      if (!isValid) {
        return NextResponse.redirect(new URL("/login?error=incorrect_password", request.url));
      }

      const cookieStore = await cookies();
      cookieStore.set("demo_access_token", "true", {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24, // 24 hours
      });

      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (action === "login-profile") {
      if (appMode === "demo") {
        const cookieStore = await cookies();
        if (cookieStore.get("demo_access_token")?.value !== "true") {
          return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
        }
      }

      if (!userId) {
        return NextResponse.redirect(new URL("/login?error=missing_user_id", request.url));
      }

      const allowedUserIds = [
        "44444444-4444-4444-4444-444444444444", // Kristof (ADMIN)
        "55555555-5555-5555-5555-555555555555", // Sabine (FAMILY_SELLER)
        "66666666-6666-6666-6666-666666666666", // Assistant (VIEWER)
      ];

      if (!allowedUserIds.includes(userId)) {
        return NextResponse.redirect(new URL("/login?error=invalid_user_id", request.url));
      }

      const cookieStore = await cookies();
      cookieStore.set("lego_demo_user_id", userId, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 1 week
      });

      return NextResponse.redirect(new URL("/", request.url));
    }

    if (action === "logout") {
      const cookieStore = await cookies();
      cookieStore.delete("lego_demo_user_id");
      cookieStore.delete("demo_access_token");
      return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.redirect(new URL("/login?error=invalid_action", request.url));
  } catch (error) {
    console.error("Demo auth API error:", error);
    return NextResponse.redirect(new URL("/login?error=server_error", request.url));
  }
}
