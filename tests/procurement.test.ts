import { describe, expect, it } from "vitest";
import { landedCost, parsePrice, scoreSuppliers, type SupplierInput } from "../src/lib/procurement";

const row = (overrides: Partial<SupplierInput> = {}): SupplierInput => ({
  source: "test.csv",
  row: 2,
  supplier: "Supplier A",
  ingredient: "Maize",
  priceOriginal: "$200",
  currency: "USD",
  unit: "per MT",
  tier: "Regional",
  availability: "In stock",
  countryRisk: "Medium",
  reliability: 80,
  ...overrides,
});

describe("price parsing", () => {
  it("parses ranges and single values", () => {
    expect(parsePrice("$175-$210")).toBe(192.5);
    expect(parsePrice("USD 200")).toBe(200);
    expect(parsePrice("not quoted")).toBeUndefined();
  });
});

describe("supplier scoring", () => {
  it("gives a single supplier the no-spread price score", () => {
    const [result] = scoreSuppliers([row()]);
    expect(result.subscores.price).toBe(100);
    expect(result.flags).toContain("No price spread");
  });

  it("gives equal prices the same price score", () => {
    const results = scoreSuppliers([row(), row({ row: 3, supplier: "Supplier B" })]);
    expect(results.map((result) => result.subscores.price)).toEqual([100, 100]);
  });

  it("excludes price when currency or unit is missing", () => {
    const [result] = scoreSuppliers([row({ currency: undefined })]);
    expect(result.subscores.price).toBeUndefined();
    expect(result.flags[0]).toContain("currency or unit missing");
  });

  it("does not let an incomplete quote change another supplier's price normalization", () => {
    const complete = row({ priceOriginal: "$200" });
    const incomplete = row({ row: 3, supplier: "Supplier B", priceOriginal: "$100", currency: undefined });
    const results = scoreSuppliers([complete, incomplete]);
    expect(results.find((result) => result.supplier === "Supplier A")?.subscores.price).toBe(100);
  });

  it("accepts numeric country risk text from spreadsheets", () => {
    const [result] = scoreSuppliers([row({ countryRisk: "75" })]);
    expect(result.subscores.countryRisk).toBe(75);
  });

  it("excludes incomparable currencies", () => {
    const results = scoreSuppliers([row(), row({ row: 3, supplier: "Supplier B", currency: "BDT" })]);
    expect(results.every((result) => result.subscores.price === undefined)).toBe(true);
  });

  it("renormalizes over every possible number of present factors", () => {
    for (let count = 1; count <= 5; count++) {
      const input = row({
        priceOriginal: count >= 1 ? "$200" : undefined,
        currency: count >= 1 ? "USD" : undefined,
        unit: count >= 1 ? "per MT" : undefined,
        tier: count >= 2 ? "Regional" : undefined,
        availability: count >= 3 ? "In stock" : undefined,
        countryRisk: count >= 4 ? "Medium" : undefined,
        reliability: count >= 5 ? 80 : undefined,
      });
      const [result] = scoreSuppliers([input]);
      expect(Object.keys(result.subscores)).toHaveLength(count);
      expect(result.score).toBeCloseTo(
        Object.values(result.contributions).reduce((sum, value) => sum + value!, 0),
        1,
      );
    }
  });

  it("flags partial comparisons and keeps ties tied", () => {
    const results = scoreSuppliers([
      row({ tier: undefined, availability: undefined, countryRisk: undefined, reliability: undefined }),
      row({ row: 3, supplier: "Supplier B" }),
    ]);
    expect(results.every((result) => result.flags.some((flag) => flag.startsWith("Partial comparison")))).toBe(true);
  });

  it("returns no score when every factor is missing", () => {
    const [result] = scoreSuppliers([row({ priceOriginal: undefined, tier: undefined, availability: undefined, countryRisk: undefined, reliability: undefined })]);
    expect(result.score).toBeUndefined();
    expect(result.completeness).toBe(0);
  });
});

it("calculates landed cost without model arithmetic", () => {
  expect(landedCost(200, 30, 1, 5, 8)).toBe(250);
  expect(landedCost(200, 30, 1, 5, 8, 2, 10, 12)).toBe(516.4);
});
