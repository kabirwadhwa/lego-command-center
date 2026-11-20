import { lookupSet, clearSetFactsCache } from "@/services/pricing/setFacts/setFactsService";
import { SET_FACTS_SEED } from "@/services/pricing/setFacts/setFactsSeed";
import { Fetcher } from "@/services/pricing/setFacts/brickEconomyClient";

// A fetcher that throws if called: proves the seed path makes NO network call.
const explodingFetcher: Fetcher = async () => {
  throw new Error("network must not be touched for a seeded set");
};

describe("seeded sets return real values with no network call", () => {
  beforeEach(() => clearSetFactsCache());

  it("serves a seeded retired set entirely from cache", async () => {
    const f = await lookupSet("10255", { fetcher: explodingFetcher });
    expect(f.name).toBe("Assembly Square");
    expect(f.rrp).toBe(299.99);
    expect(f.currentValueNew).toBe(320.59);
    expect(f.retirementDate).toBe("February 2024");
    expect(f.resolutionError).toBeNull();
  });

  it("serves the set that previously broke (40761) with its real value, not €0", async () => {
    const f = await lookupSet("40761", { fetcher: explodingFetcher });
    expect(f.currentValueNew).toBe(123.84);
    expect(f.rrpBasis).toBe("FREE_PROMOTIONAL");
    expect(f.rrp).toBeNull();
  });

  it("gives still-exclusive headliners a current value from retail basis", async () => {
    const falcon = await lookupSet("75192", { fetcher: explodingFetcher });
    expect(falcon.currentValueNew).toBe(849.99);
    expect(falcon.valueBasis).toBe("RETAIL_PRICE");
  });

  it("accepts the -1 suffix and matches the same seed entry", async () => {
    const f = await lookupSet("10255-1", { fetcher: explodingFetcher });
    expect(f.name).toBe("Assembly Square");
  });

  it("every seeded entry carries a value and no resolution error", () => {
    const bad = Object.entries(SET_FACTS_SEED).filter(
      ([, f]) => f.resolutionError !== null || f.currentValueNew === null || (f.currentValueNew ?? 0) <= 0
    );
    expect(bad.map(([n]) => n)).toEqual([]);
  });

  it("forceRefresh skips the seed and goes to the network", async () => {
    await expect(lookupSet("10255", { fetcher: explodingFetcher, forceRefresh: true })).resolves.toMatchObject({
      resolutionError: expect.stringMatching(/network must not be touched/),
    });
  });
});
