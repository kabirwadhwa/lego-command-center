import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { lookupKnownPart } from "./legoPartsCatalog";
import { lookupKnownSet } from "./legoSetsCatalog";

export interface SourceReference {
  source: string;
  url?: string | null;
  matchedIdentifier?: string;
  confidence?: number | null;
}

export type LegoIdentifierType =
  | "LEGO_SET"
  | "LEGO_PART"
  | "INTERNAL_SKU"
  | "EAN"
  | "UNKNOWN";

export interface ResolvedLegoProduct {
  input: string;
  identifierType: LegoIdentifierType;
  canonicalIdentifier: string;
  name: string | null;
  theme: string | null;
  year: number | null;
  imageUrl: string | null;
  ean: string | null;
  identificationSources: SourceReference[];
  identificationConfidence: number | null;
  availableColors?: string[];
  elementIds?: string[];
  partCategory?: string | null;
}

// In-memory cache for local inventory-seed catalog
let seedCatalogCache: Map<string, { setName: string; theme?: string }> | null = null;

function getSeedCatalog(): Map<string, { setName: string; theme?: string }> {
  if (seedCatalogCache) return seedCatalogCache;
  seedCatalogCache = new Map();
  try {
    const seedPath = path.join(process.cwd(), "prisma", "inventory-seed.json");
    if (fs.existsSync(seedPath)) {
      const raw = fs.readFileSync(seedPath, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item.setNumber && item.setName && !seedCatalogCache.has(item.setNumber)) {
            seedCatalogCache.set(String(item.setNumber), {
              setName: item.setName,
              theme: "LEGO System",
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[ProductIdentificationService] Could not read inventory-seed.json:", err);
  }
  return seedCatalogCache;
}

export class ProductIdentificationService {
  /**
   * Normalizes an identifier string.
   */
  static normalizeIdentifier(raw: string): string {
    if (!raw) return "";
    let clean = raw.trim();
    clean = clean.replace(/^(?:LEGO|SET|PART|DESIGN|ELEMENT|SKU|EAN|LGO)[-_\s:]+/i, "");
    clean = clean.replace(/-[0-9]+$/, ""); // Strip trailing "-1" Bricklink/Rebrickable set suffix
    return clean.trim();
  }

  /**
   * Main resolution method: accurately identifies any LEGO input.
   * Checks local database, seed catalog, curated part definitions, and external APIs.
   * Never invents metadata or guesses silently.
   */
  static async resolveProduct(input: string): Promise<ResolvedLegoProduct> {
    const rawTrimmed = input ? input.trim() : "";
    if (!rawTrimmed) {
      return {
        input: rawTrimmed,
        identifierType: "UNKNOWN",
        canonicalIdentifier: "",
        name: null,
        theme: null,
        year: null,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: null,
      };
    }

    const sources: SourceReference[] = [];
    const normalized = this.normalizeIdentifier(rawTrimmed);

    // 1. Explicit Prefix Classification
    const upperRaw = rawTrimmed.toUpperCase();
    const isExplicitPart = /^(?:PART|DESIGN|ELEMENT)[-_\s:]+/i.test(upperRaw);
    const isExplicitSet = /^(?:SET)[-_\s:]+/i.test(upperRaw);
    const isExplicitSku = /^(?:SKU|LGO|INV)[-_\s:]+/i.test(upperRaw) || /-(?:NEW|USED|DAMAGED)$/i.test(upperRaw);

    // 2. Check for EAN / GTIN (12 or 13 digits)
    if (/^[0-9]{12,13}$/.test(rawTrimmed)) {
      // Check if this EAN exists in local Product table
      let dbProductByEan = null;
      try {
        dbProductByEan = await prisma.product.findFirst({
          where: { ean: rawTrimmed },
        });
      } catch {
        // Database not reachable or offline; proceed
      }

      if (dbProductByEan) {
        sources.push({ source: "Local Product Catalog", matchedIdentifier: rawTrimmed, confidence: 1.0 });
        return {
          input: rawTrimmed,
          identifierType: "EAN",
          canonicalIdentifier: dbProductByEan.setNumber,
          name: dbProductByEan.name,
          theme: dbProductByEan.theme,
          year: null,
          imageUrl: dbProductByEan.imageUrl,
          ean: rawTrimmed,
          identificationSources: sources,
          identificationConfidence: 1.0,
        };
      }

      // Check external EAN lookup if available
      return {
        input: rawTrimmed,
        identifierType: "EAN",
        canonicalIdentifier: rawTrimmed,
        name: null,
        theme: null,
        year: null,
        imageUrl: null,
        ean: rawTrimmed,
        identificationSources: [{ source: "EAN Barcode Detector", matchedIdentifier: rawTrimmed, confidence: 0.85 }],
        identificationConfidence: 0.85,
      };
    }

    // 3. Check for Internal SKU in ProductVariant
    if (isExplicitSku || upperRaw.startsWith("LGO-")) {
      let variant = null;
      try {
        variant = await prisma.productVariant.findUnique({
          where: { sku: upperRaw },
          include: { product: true },
        });
      } catch {
        // Database not reachable or offline; proceed
      }

      if (variant) {
        sources.push({ source: "Inventory Ledger SKU", matchedIdentifier: variant.sku, confidence: 1.0 });
        return {
          input: rawTrimmed,
          identifierType: "INTERNAL_SKU",
          canonicalIdentifier: variant.product.setNumber,
          name: variant.product.name,
          theme: variant.product.theme,
          year: null,
          imageUrl: variant.product.imageUrl,
          ean: variant.product.ean,
          identificationSources: sources,
          identificationConfidence: 1.0,
        };
      }
    }

    // 4. Check Curated Known LEGO Parts Reference (deterministic resolution for parts like 35106)
    const partDef = lookupKnownPart(normalized);
    if (partDef && (!isExplicitSet || isExplicitPart)) {
      sources.push({ source: "LEGO Design & Element Catalog", matchedIdentifier: partDef.designId, confidence: 0.98 });
      return {
        input: rawTrimmed,
        identifierType: "LEGO_PART",
        canonicalIdentifier: partDef.designId,
        name: partDef.name,
        theme: partDef.category,
        year: null,
        imageUrl: partDef.imageUrl || null,
        ean: null,
        identificationSources: sources,
        identificationConfidence: 0.98,
        availableColors: partDef.availableColors,
        elementIds: partDef.elementIds,
        partCategory: partDef.category,
      };
    }

    // 5. Check Local Database Product Table
    let dbProduct = null;
    try {
      dbProduct = await prisma.product.findUnique({
        where: { setNumber: normalized },
      });
    } catch {
      // Database not reachable or offline; proceed
    }

    if (dbProduct) {
      const isPartType = dbProduct.productType === "LEGO_PART";
      sources.push({ source: "Local Database Catalog", matchedIdentifier: dbProduct.setNumber, confidence: 0.95 });
      return {
        input: rawTrimmed,
        identifierType: isPartType ? "LEGO_PART" : "LEGO_SET",
        canonicalIdentifier: dbProduct.setNumber,
        name: dbProduct.name,
        theme: dbProduct.theme,
        year: null,
        imageUrl: dbProduct.imageUrl,
        ean: dbProduct.ean,
        identificationSources: sources,
        identificationConfidence: 0.95,
      };
    }

    // 6. Check Curated Known LEGO Sets Reference (deterministic resolution for sets like 21006, 21036, 75192)
    const setDef = lookupKnownSet(normalized);
    if (setDef && !isExplicitPart) {
      sources.push({ source: "Curated LEGO Sets Catalog", matchedIdentifier: setDef.setNumber, confidence: 0.98 });
      return {
        input: rawTrimmed,
        identifierType: "LEGO_SET",
        canonicalIdentifier: setDef.setNumber,
        name: setDef.name,
        theme: setDef.theme,
        year: setDef.year || null,
        imageUrl: setDef.imageUrl || null,
        ean: null,
        identificationSources: sources,
        identificationConfidence: 0.98,
      };
    }

    // 6.5 Check Inventory Seed Catalog
    const seedCatalog = getSeedCatalog();
    const seedItem = seedCatalog.get(normalized);
    if (seedItem && !isExplicitPart) {
      sources.push({ source: "Inventory Seed Reference", matchedIdentifier: normalized, confidence: 0.92 });
      return {
        input: rawTrimmed,
        identifierType: "LEGO_SET",
        canonicalIdentifier: normalized,
        name: seedItem.setName,
        theme: seedItem.theme || "LEGO System",
        year: null,
        imageUrl: null,
        ean: null,
        identificationSources: sources,
        identificationConfidence: 0.92,
      };
    }

    // 7. External Rebrickable API (if REBRICKABLE_API_KEY configured)
    if (process.env.REBRICKABLE_API_KEY) {
      const key = process.env.REBRICKABLE_API_KEY;

      // If user indicated part or standard 4-5 digit design ID, check part endpoint first
      if (isExplicitPart || (!isExplicitSet && /^[0-9]{4,6}$/.test(normalized))) {
        try {
          const res = await fetch(`https://rebrickable.com/api/v3/lego/parts/${normalized}/`, {
            headers: { Authorization: `key ${key}` },
          });
          if (res.ok) {
            const data = await res.json();
            sources.push({ source: "Rebrickable API (Part)", matchedIdentifier: normalized, confidence: 0.95 });
            return {
              input: rawTrimmed,
              identifierType: "LEGO_PART",
              canonicalIdentifier: normalized,
              name: data.name,
              theme: data.part_cat_id ? `Category ${data.part_cat_id}` : null,
              year: data.year_from || null,
              imageUrl: data.part_img_url || null,
              ean: null,
              identificationSources: sources,
              identificationConfidence: 0.95,
            };
          }
        } catch (err) {
          console.warn("[ProductIdentificationService] Rebrickable part query error:", err);
        }
      }

      // Check Rebrickable set endpoint
      try {
        const setQuery = normalized.includes("-") ? normalized : `${normalized}-1`;
        const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setQuery}/`, {
          headers: { Authorization: `key ${key}` },
        });
        if (res.ok) {
          const data = await res.json();
          sources.push({ source: "Rebrickable API (Set)", matchedIdentifier: normalized, confidence: 0.95 });
          return {
            input: rawTrimmed,
            identifierType: "LEGO_SET",
            canonicalIdentifier: normalized,
            name: data.name,
            theme: data.theme_id ? `Theme ${data.theme_id}` : null,
            year: data.year || null,
            imageUrl: data.set_img_url || null,
            ean: null,
            identificationSources: sources,
            identificationConfidence: 0.95,
          };
        }
      } catch (err) {
        console.warn("[ProductIdentificationService] Rebrickable set query error:", err);
      }
    }

    // 8. Heuristic Resolution for Numerical Identifiers
    // LEGO set numbers are typically 4 to 7 digits.
    // If it's a numeric string and wasn't resolved as a known part or set:
    if (/^[0-9]{3,7}$/.test(normalized)) {
      if (isExplicitPart) {
        return {
          input: rawTrimmed,
          identifierType: "LEGO_PART",
          canonicalIdentifier: normalized,
          name: `LEGO Part ${normalized}`,
          theme: "Elements",
          year: null,
          imageUrl: null,
          ean: null,
          identificationSources: [{ source: "User Syntax Prefix (Part)", matchedIdentifier: normalized, confidence: 0.7 }],
          identificationConfidence: 0.7,
        };
      }

      if (isExplicitSet) {
        return {
          input: rawTrimmed,
          identifierType: "LEGO_SET",
          canonicalIdentifier: normalized,
          name: `LEGO Set ${normalized}`,
          theme: null,
          year: null,
          imageUrl: null,
          ean: null,
          identificationSources: [{ source: "User Syntax Prefix (Set)", matchedIdentifier: normalized, confidence: 0.7 }],
          identificationConfidence: 0.7,
        };
      }

      // If user entered digits without explicit prefix and neither catalog confirmed it:
      // It is ambiguous (could be an obscure part or uncataloged set).
      // Truthful representation: UNKNOWN with null confidence!
      return {
        input: rawTrimmed,
        identifierType: "UNKNOWN",
        canonicalIdentifier: normalized,
        name: null,
        theme: null,
        year: null,
        imageUrl: null,
        ean: null,
        identificationSources: [],
        identificationConfidence: null,
      };
    }

    // 9. Textual Product Name Search in Local Catalog
    let matchingProducts: Awaited<ReturnType<typeof prisma.product.findMany>> = [];
    try {
      matchingProducts = await prisma.product.findMany({
        where: { name: { contains: rawTrimmed, mode: "insensitive" } },
        take: 1,
      });
    } catch {
      // Database not reachable or offline; proceed
    }

    if (matchingProducts.length > 0) {
      const match = matchingProducts[0];
      sources.push({ source: "Catalog Text Search", matchedIdentifier: match.setNumber, confidence: 0.8 });
      return {
        input: rawTrimmed,
        identifierType: match.productType === "LEGO_PART" ? "LEGO_PART" : "LEGO_SET",
        canonicalIdentifier: match.setNumber,
        name: match.name,
        theme: match.theme,
        year: null,
        imageUrl: match.imageUrl,
        ean: match.ean,
        identificationSources: sources,
        identificationConfidence: 0.8,
      };
    }

    // 10. Fallback: UNKNOWN
    return {
      input: rawTrimmed,
      identifierType: "UNKNOWN",
      canonicalIdentifier: normalized,
      name: null,
      theme: null,
      year: null,
      imageUrl: null,
      ean: null,
      identificationSources: [],
      identificationConfidence: null,
    };
  }
}
