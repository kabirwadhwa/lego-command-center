import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppMode } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("Not Found", { status: 404 });
}

export async function POST(request: Request) {
  // Production security rule: Disable test/debug endpoints completely in production
  if (getAppMode() === "production" || process.env.ENABLE_TEST_ROUTES !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (token !== "7919a1be-8967-4e2d-a3a6-1b11cf106a64") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { model, action, args } = body;

    if (!model || !action) {
      return new NextResponse("Missing model or action", { status: 400 });
    }

    // Dynamic model access safely mapped
    const client = prisma as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>;
    const prismaModel = client[model];
    if (!prismaModel || typeof prismaModel[action] !== "function") {
      return new NextResponse(`Invalid model (${model}) or action (${action})`, { status: 400 });
    }

    const result = await prismaModel[action](args || {});
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Test Query API error:", error);
    const msg = error instanceof Error ? error.message : "Internal Error";
    return new NextResponse(msg, { status: 500 });
  }
}
