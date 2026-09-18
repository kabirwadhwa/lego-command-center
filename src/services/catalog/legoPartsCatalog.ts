/**
 * Curated LEGO Design/Part ID catalog reference.
 * Provides deterministic identification for canonical LEGO parts and elements.
 */

export interface LegoPartDefinition {
  designId: string;
  name: string;
  category: string;
  availableColors: string[];
  elementIds?: string[];
  imageUrl?: string;
}

export const KNOWN_LEGO_PARTS: Record<string, LegoPartDefinition> = {
  "35106": {
    designId: "35106",
    name: "Aircraft Fuselage 4 x 16 x 1 Curved Forward Top with 6 Windows",
    category: "Vehicle, Aircraft",
    availableColors: ["White", "Light Bluish Gray", "Dark Bluish Gray", "Red", "Blue"],
    elementIds: ["6221711", "6221712", "6221713"],
  },
  "54095": {
    designId: "54095",
    name: "Aircraft Fuselage Curved Aft Bottom 8 x 16 x 2 1/3",
    category: "Vehicle, Aircraft",
    availableColors: ["White", "Light Bluish Gray", "Red"],
  },
  "54096": {
    designId: "54096",
    name: "Aircraft Fuselage Curved Forward Bottom 8 x 16 x 2 1/3",
    category: "Vehicle, Aircraft",
    availableColors: ["White", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3001": {
    designId: "3001",
    name: "Brick 2 x 4",
    category: "Bricks",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Green", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3002": {
    designId: "3002",
    name: "Brick 2 x 3",
    category: "Bricks",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray"],
  },
  "3003": {
    designId: "3003",
    name: "Brick 2 x 2",
    category: "Bricks",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3004": {
    designId: "3004",
    name: "Brick 1 x 2",
    category: "Bricks",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3005": {
    designId: "3005",
    name: "Brick 1 x 1",
    category: "Bricks",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Trans-Clear"],
  },
  "3020": {
    designId: "3020",
    name: "Plate 2 x 4",
    category: "Plates",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3023": {
    designId: "3023",
    name: "Plate 1 x 2",
    category: "Plates",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3666": {
    designId: "3666",
    name: "Plate 1 x 6",
    category: "Plates",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray", "Dark Bluish Gray"],
  },
  "3710": {
    designId: "3710",
    name: "Plate 1 x 4",
    category: "Plates",
    availableColors: ["Red", "Blue", "Yellow", "White", "Black", "Light Bluish Gray", "Dark Bluish Gray"],
  },
};

export function lookupKnownPart(idOrDesign: string): LegoPartDefinition | null {
  const normalized = idOrDesign.trim().toUpperCase().replace(/^(?:PART|DESIGN|ELEMENT)[-_\s]+/i, "");
  return KNOWN_LEGO_PARTS[normalized] || null;
}
