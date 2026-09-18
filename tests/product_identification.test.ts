import { ProductIdentificationService } from "@/services/catalog/productIdentificationService";

describe("ProductIdentificationService: Intelligent LEGO Identifier Resolution", () => {
  test("Resolves canonical LEGO set number 75192 from seed catalog", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("75192");
    expect(resolved.identifierType).toBe("LEGO_SET");
    expect(resolved.canonicalIdentifier).toBe("75192");
    expect(resolved.name).toContain("Millennium Falcon");
    expect(resolved.identificationConfidence).toBeGreaterThanOrEqual(0.85);
    expect(resolved.identificationSources.length).toBeGreaterThan(0);
  });

  test("Resolves LEGO set with common prefixes ('SET-10316', 'LEGO 75192-1')", async () => {
    const r1 = await ProductIdentificationService.resolveProduct("SET-10316");
    expect(r1.identifierType).toBe("LEGO_SET");
    expect(r1.canonicalIdentifier).toBe("10316");

    const r2 = await ProductIdentificationService.resolveProduct("LEGO 75192-1");
    expect(r2.identifierType).toBe("LEGO_SET");
    expect(r2.canonicalIdentifier).toBe("75192");
  });

  test("Accurately identifies 35106 as LEGO_PART (Aircraft Fuselage), NOT a LEGO set", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("35106");
    expect(resolved.identifierType).toBe("LEGO_PART");
    expect(resolved.canonicalIdentifier).toBe("35106");
    expect(resolved.name).toContain("Aircraft Fuselage");
    expect(resolved.availableColors).toBeDefined();
    expect(resolved.availableColors).toContain("White");
    expect(resolved.identificationConfidence).toBeGreaterThanOrEqual(0.95);
  });

  test("Accurately identifies known part 3001 as LEGO_PART (Brick 2 x 4)", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("3001");
    expect(resolved.identifierType).toBe("LEGO_PART");
    expect(resolved.canonicalIdentifier).toBe("3001");
    expect(resolved.name).toBe("Brick 2 x 4");
    expect(resolved.availableColors).toContain("Red");
  });

  test("Identifies explicit prefix PART-35106 or 'PART 35106' as LEGO_PART", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("PART 35106");
    expect(resolved.identifierType).toBe("LEGO_PART");
    expect(resolved.canonicalIdentifier).toBe("35106");
    expect(resolved.name).toContain("Aircraft Fuselage");
  });

  test("Identifies 13-digit barcode as EAN identifier type", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("5702016914337");
    expect(resolved.identifierType).toBe("EAN");
    expect(resolved.ean).toBe("5702016914337");
    expect(resolved.identificationConfidence).toBeGreaterThan(0.7);
  });

  test("Does NOT fabricate a set for unindexed digits; classifies as UNKNOWN with null confidence", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("9999988");
    expect(resolved.identifierType).toBe("UNKNOWN");
    expect(resolved.name).toBeNull();
    expect(resolved.identificationConfidence).toBeNull();
  });

  test("Handles empty or blank input safely without throwing", async () => {
    const resolved = await ProductIdentificationService.resolveProduct("");
    expect(resolved.identifierType).toBe("UNKNOWN");
    expect(resolved.canonicalIdentifier).toBe("");
    expect(resolved.name).toBeNull();
  });
});
