import { MarketplaceType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { MarketplaceAdapter } from "./types";
import { ShopifyAdapter } from "./shopify";
import { BolAdapter } from "./bol";
import { CatawikiAdapter } from "./catawiki";

export class MarketplaceFactory {
  static async getAdapter(type: MarketplaceType): Promise<MarketplaceAdapter> {
    const config = await prisma.marketplace.findUnique({
      where: { id: type },
    });

    const mode = (config?.mode === "REAL" ? "REAL" : "DEMO") as "REAL" | "DEMO";
    
    const mergedCreds: Record<string, string> = {};
    if (config?.credentialsJson) {
      try {
        Object.assign(mergedCreds, JSON.parse(config.credentialsJson));
      } catch {}
    }

    if (type === MarketplaceType.SHOPIFY) {
      if (process.env.SHOPIFY_STORE_DOMAIN) mergedCreds.shopName = process.env.SHOPIFY_STORE_DOMAIN;
      if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) mergedCreds.accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
      if (process.env.SHOPIFY_WEBHOOK_SECRET) mergedCreds.webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    } else if (type === MarketplaceType.BOL) {
      if (process.env.BOL_CLIENT_SECRET) mergedCreds.clientSecret = process.env.BOL_CLIENT_SECRET;
    }

    const credentialsJson = JSON.stringify(mergedCreds);

    switch (type) {
      case MarketplaceType.SHOPIFY:
        return new ShopifyAdapter(mode, credentialsJson);
      case MarketplaceType.BOL:
        return new BolAdapter(mode, credentialsJson);
      case MarketplaceType.CATAWIKI:
        return new CatawikiAdapter(mode, credentialsJson);
      default:
        throw new Error(`Unsupported marketplace type: ${type}`);
    }
  }
}
