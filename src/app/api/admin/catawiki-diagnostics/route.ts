import { NextResponse } from "next/server";
import { checkRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { testCatawikiDiagnosticsAction } from "@/app/actions/marketplaceActions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await checkRole([UserRole.ADMIN]);
  } catch {
    return NextResponse.json({ error: "Unauthorized. Admin role required." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const identifier = searchParams.get("identifier") || searchParams.get("q") || "10316";

  const result = await testCatawikiDiagnosticsAction(identifier);
  return NextResponse.json(result);
}
