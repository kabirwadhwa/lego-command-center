import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { MarketplaceType, EventStatus } from "@prisma/client";
import { MarketplaceEventProcessor } from "@/services/marketplace/eventProcessor";

export async function POST(request: Request) {
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const topicHeader = request.headers.get("x-shopify-topic") || "orders/create";
  const webhookIdHeader = request.headers.get("x-shopify-webhook-id");

  if (!webhookIdHeader) {
    return new NextResponse("Missing Webhook ID header", { status: 400 });
  }

  // 1. Fetch Shopify credentials to retrieve the webhook secret
  const shopify = await prisma.marketplace.findUnique({
    where: { id: MarketplaceType.SHOPIFY },
  });

  const isDemo = shopify?.mode === "DEMO";
  let webhookSecret = "";

  if (shopify?.credentialsJson) {
    try {
      const creds = JSON.parse(shopify.credentialsJson);
      webhookSecret = creds.webhookSecret || "";
    } catch {
      // Ignore parse errors
    }
  }

  const rawBody = await request.text();

  // 2. Validate HMAC signature (skip ONLY if in DEMO mode AND webhookSecret is empty)
  const shouldVerify = !isDemo || !!webhookSecret;
  if (shouldVerify) {
    if (!hmacHeader || !webhookSecret) {
      return new NextResponse("Unauthorized: Missing signature credentials", { status: 401 });
    }

    const computedHmac = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody, "utf8")
      .digest("base64");

    if (computedHmac !== hmacHeader) {
      return new NextResponse("Unauthorized: Invalid signature", { status: 401 });
    }
  }

  // 3. Persist the event to enforce event-level idempotency
  try {
    const existingEvent = await prisma.marketplaceEvent.findUnique({
      where: {
        marketplaceId_externalEventId: {
          marketplaceId: MarketplaceType.SHOPIFY,
          externalEventId: webhookIdHeader,
        },
      },
    });

    if (existingEvent) {
      return NextResponse.json({ success: true, duplicated: true, message: "Duplicate event ignored." });
    }

    let externalOrderId: string | null = null;
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed.id) {
        externalOrderId = String(parsed.id);
      }
    } catch {
      // Ignore JSON parse errors for non-JSON payloads
    }

    const event = await prisma.marketplaceEvent.create({
      data: {
        marketplaceId: MarketplaceType.SHOPIFY,
        externalEventId: webhookIdHeader,
        eventType: topicHeader,
        externalOrderId,
        processingStatus: EventStatus.PENDING,
        payload: rawBody,
      },
    });

    const procResult = await MarketplaceEventProcessor.processEvent(event.id);

    if (!procResult.success) {
      return NextResponse.json({ success: true, processed: false, error: procResult.error, eventId: event.id });
    }

    return NextResponse.json({ success: true, processed: true, eventId: event.id });
  } catch (err) {
    console.error("Shopify webhook processing error:", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
