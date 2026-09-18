import { EvidenceValidator } from "@/services/pricing/providers/evidenceValidator";
import { ObservationProvenance } from "@prisma/client";

describe("EvidenceValidator: Verification, Normalization & Deduplication", () => {
  test("Requires exact canonical identifier match with boundary regex", () => {
    // 35106 present as exact token
    const score1 = EvidenceValidator.calculateProductMatchScore(
      "LEGO Part 35106 Aircraft Fuselage Top White",
      "35106",
      "Aircraft Fuselage"
    );
    expect(score1).toBeGreaterThanOrEqual(0.85);

    // Partial overlap (e.g. 135106 or 351060) should NOT match
    const score2 = EvidenceValidator.calculateProductMatchScore(
      "LEGO Item 1351060 Special Brick",
      "35106"
    );
    expect(score2).toBe(0.0);
  });

  test("Recognizes genuine marketplace domains and rejects suspicious/untrusted domains", () => {
    expect(EvidenceValidator.isRecognizedMarketplaceDomain("https://www.ebay.com/itm/123456")).toBe(true);
    expect(EvidenceValidator.isRecognizedMarketplaceDomain("https://www.bricklink.com/v2/catalog/catalogitem.page?P=35106")).toBe(true);
    expect(EvidenceValidator.isRecognizedMarketplaceDomain("https://www.catawiki.com/en/l/12345")).toBe(true);
    expect(EvidenceValidator.isRecognizedMarketplaceDomain("https://www.brickowl.com/catalog/lego-piece-35106")).toBe(true);
    expect(EvidenceValidator.isRecognizedMarketplaceDomain("https://random-scam-blog.xyz/view/35106")).toBe(false);
  });

  test("Extracts price and performs accurate FX conversion to EUR", () => {
    // EUR extraction
    const p1 = EvidenceValidator.extractPriceAndCurrency("Buy Now: €14.50 + shipping");
    expect(p1).toEqual({ price: 14.50, currency: "EUR" });
    expect(EvidenceValidator.convertToEur(14.50, "EUR")).toBe(14.50);

    // USD extraction and conversion
    const p2 = EvidenceValidator.extractPriceAndCurrency("Sold for $21.60 on eBay");
    expect(p2).toEqual({ price: 21.60, currency: "USD" });
    expect(EvidenceValidator.convertToEur(21.60, "USD")).toBe(20.00); // 21.60 / 1.08 = 20.00

    // GBP extraction and conversion
    const p3 = EvidenceValidator.extractPriceAndCurrency("Price: £8.50");
    expect(p3).toEqual({ price: 8.50, currency: "GBP" });
    expect(EvidenceValidator.convertToEur(8.50, "GBP")).toBe(10.00); // 8.50 / 0.85 = 10.00
  });

  test("Accurately classifies sale type (SOLD vs ACTIVE vs AUCTION)", () => {
    expect(EvidenceValidator.classifySaleType("Sold on Nov 12, 2025 - Completed Listing")).toBe("SOLD");
    expect(EvidenceValidator.classifySaleType("5 bids · Current bid €45.00")).toBe("AUCTION");
    expect(EvidenceValidator.classifySaleType("Buy It Now · In Stock")).toBe("ACTIVE_LISTING");
  });

  test("Accurately classifies condition and part color", () => {
    expect(EvidenceValidator.classifyCondition("Brand New Sealed In Box MISB")).toBe("NEW_SEALED");
    expect(EvidenceValidator.classifyCondition("Pre-owned complete with minifigures")).toBe("USED_COMPLETE");
    expect(EvidenceValidator.detectPartColor("LEGO Aircraft Fuselage in Light Bluish Gray")).toBe("Light Bluish Gray");
    expect(EvidenceValidator.detectPartColor("White Fuselage Section 4x16")).toBe("White");
  });

  test("Strictly rejects any candidate with simulated provenance or simulated artifacts", () => {
    const candidateSimUrl = EvidenceValidator.validateCandidate({
      provider: "test",
      marketplace: "EBAY",
      title: "LEGO 35106 Fuselage",
      price: 15.00,
      externalUrl: "https://www.ebay.com/itm/simulated-35106-listing",
      canonicalIdentifier: "35106",
    });
    expect(candidateSimUrl).toBeNull();

    const candidateSimSeller = EvidenceValidator.validateCandidate({
      provider: "test",
      marketplace: "EBAY",
      title: "LEGO 35106 Fuselage",
      price: 15.00,
      seller: "Simulated Seller #99",
      externalUrl: "https://www.ebay.com/itm/123456789",
      canonicalIdentifier: "35106",
    });
    expect(candidateSimSeller).toBeNull();

    const candidateSimProv = EvidenceValidator.validateCandidate({
      provider: "test",
      marketplace: "EBAY",
      title: "LEGO 35106 Fuselage",
      price: 15.00,
      externalUrl: "https://www.ebay.com/itm/123456789",
      canonicalIdentifier: "35106",
      provenance: ObservationProvenance.SIMULATED,
    });
    expect(candidateSimProv).toBeNull();
  });

  test("Deduplicates identical listings across sources", () => {
    const ev1 = EvidenceValidator.validateCandidate({
      provider: "ebay",
      marketplace: "EBAY",
      title: "LEGO 35106 Aircraft Fuselage White",
      price: 12.00,
      seller: "BrickSeller123",
      externalUrl: "https://www.ebay.com/itm/123456789?utm_source=google&ref=share",
      canonicalIdentifier: "35106",
    })!;

    const ev2 = EvidenceValidator.validateCandidate({
      provider: "web_search",
      marketplace: "EBAY",
      title: "LEGO 35106 Aircraft Fuselage White",
      price: 12.00,
      seller: "BrickSeller123",
      externalUrl: "https://www.ebay.com/itm/123456789",
      canonicalIdentifier: "35106",
    })!;

    expect(ev1).not.toBeNull();
    expect(ev2).not.toBeNull();

    const deduped = EvidenceValidator.deduplicate([ev1, ev2]);
    expect(deduped.length).toBe(1);
  });
});
