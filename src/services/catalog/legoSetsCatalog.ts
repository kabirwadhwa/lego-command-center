/**
 * Curated LEGO Sets reference catalog.
 * Provides deterministic identification for canonical LEGO sets (Architecture, Icons, Star Wars, etc.).
 */

export interface LegoSetDefinition {
  setNumber: string;
  name: string;
  theme: string;
  year?: number;
  imageUrl?: string;
}

export const KNOWN_LEGO_SETS: Record<string, LegoSetDefinition> = {
  "21006": {
    setNumber: "21006",
    name: "The White House",
    theme: "Architecture",
    year: 2010,
  },
  "21036": {
    setNumber: "21036",
    name: "Arc de Triomphe",
    theme: "Architecture",
    year: 2017,
  },
  "75192": {
    setNumber: "75192",
    name: "Millennium Falcon (UCS)",
    theme: "Star Wars",
    year: 2017,
  },
  "10316": {
    setNumber: "10316",
    name: "The Lord of the Rings: Rivendell",
    theme: "Icons",
    year: 2023,
  },
  "10294": {
    setNumber: "10294",
    name: "Titanic",
    theme: "Icons",
    year: 2021,
  },
  "71043": {
    setNumber: "71043",
    name: "Hogwarts Castle",
    theme: "Harry Potter",
    year: 2018,
  },
  "21318": {
    setNumber: "21318",
    name: "Tree House",
    theme: "Ideas",
    year: 2019,
  },
  "10497": {
    setNumber: "10497",
    name: "Galaxy Explorer",
    theme: "Icons",
    year: 2022,
  },
  "10305": {
    setNumber: "10305",
    name: "Lion Knights' Castle",
    theme: "Icons",
    year: 2022,
  },
  "21054": {
    setNumber: "21054",
    name: "The White House (2020)",
    theme: "Architecture",
    year: 2020,
  },
};

/**
 * Looks up a LEGO set by canonical set number.
 */
export function lookupKnownSet(setNumber: string): LegoSetDefinition | null {
  if (!setNumber) return null;
  const clean = setNumber.trim();
  return KNOWN_LEGO_SETS[clean] || null;
}
