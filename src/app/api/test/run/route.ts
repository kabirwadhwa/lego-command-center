import { NextResponse } from "next/server";
import { InventoryService } from "@/services/inventoryService";
import { ActorType } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (token !== "7919a1be-8967-4e2d-a3a6-1b11cf106a64") {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { action, params } = body;

    let result;
    if (action === "recordPurchase") {
      result = await InventoryService.recordPurchase({
        actorId: "44444444-4444-4444-4444-444444444444", // Kristof Admin
        actorName: "Kristof Vervliet",
        supplier: params.supplier || "Smoke Test Supplier",
        purchaseDate: new Date(params.purchaseDate || Date.now()),
        items: params.items,
        notes: params.notes || "Live Smoke Test",
      });
    } else if (action === "transferStock") {
      result = await InventoryService.transferStock({
        actorId: "44444444-4444-4444-4444-444444444444",
        actorName: "Kristof Vervliet",
        productVariantId: params.productVariantId,
        sourceAccountId: params.sourceAccountId,
        destinationAccountId: params.destinationAccountId,
        quantity: params.quantity,
        notes: params.notes || "Live Smoke Test",
      });
    } else if (action === "recordSale") {
      result = await InventoryService.recordSale({
        actorType: ActorType.USER,
        actorId: "44444444-4444-4444-4444-444444444444",
        actorName: "Kristof Vervliet",
        saleDate: new Date(),
        items: params.items,
        grossRevenue: params.grossRevenue,
        notes: params.notes || "Live Smoke Test",
      });
    } else if (action === "adjustStock") {
      result = await InventoryService.adjustStock({
        actorId: "44444444-4444-4444-4444-444444444444",
        actorName: "Kristof Vervliet",
        productVariantId: params.productVariantId,
        inventoryAccountId: params.inventoryAccountId,
        type: params.type,
        quantityChange: params.quantityChange,
        unitCost: params.unitCost,
        notes: params.notes || "Live Smoke Test Adjustment",
      });
    } else {
      return new NextResponse(`Unknown action: ${action}`, { status: 400 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("Test Run API error:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal Error" }, { status: 500 });
  }
}
