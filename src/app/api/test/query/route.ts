import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    const prismaModel = (prisma as any)[model];
    if (!prismaModel || typeof prismaModel[action] !== "function") {
      return new NextResponse(`Invalid model (${model}) or action (${action})`, { status: 400 });
    }

    const result = await prismaModel[action](args || {});
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Test Query API error:", error);
    return new NextResponse(error.message || "Internal Error", { status: 500 });
  }
}
