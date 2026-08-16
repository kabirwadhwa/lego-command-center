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
    const credentials = config?.credentialsJson;

    switch (type) {
      case MarketplaceType.SHOPIFY:
        return new ShopifyAdapter(mode, credentials);
      case MarketplaceType.BOL:
        return new BolAdapter(mode, credentials);
      case MarketplaceType.CATAWIKI:
        return new CatawikiAdapter(mode, credentials);
      default:
        throw new Error(`Unsupported marketplace type: ${type}`);
    }
  }
}
