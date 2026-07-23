import { describe, expect, it } from "vitest";
import { landedCost, landedCostByTerm, parsePrice, scoreSuppliers, type SupplierInput } from "../src/lib/procurement";

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

  it("normalizes BDT/KG and USD/MT before price scoring", () => {
    const results = scoreSuppliers([
      row({ priceOriginal: "$200", currency: "USD", unit: "per MT" }),
      row({ row: 3, supplier: "Supplier B", priceOriginal: "24", currency: "BDT", unit: "per KG" }),
    ], { fxRate: 120 });
    expect(results.find((result) => result.supplier === "Supplier A")?.normalizedMidpoint).toBe(200);
    expect(results.find((result) => result.supplier === "Supplier B")?.normalizedMidpoint).toBe(200);
    expect(results.find((result) => result.supplier === "Supplier A")?.subscores.price).toBe(100);
  });

  it("normalizes supported offline currencies", () => {
    const results = scoreSuppliers([
      row({ priceOriginal: "720", currency: "CNY", unit: "per MT" }),
      row({ row: 3, supplier: "Supplier B", priceOriginal: "100", currency: "EUR", unit: "per MT" }),
    ]);
    expect(results.find((result) => result.supplier === "Supplier A")?.normalizedMidpoint).toBe(100);
    expect(results.find((result) => result.supplier === "Supplier B")?.normalizedMidpoint).toBe(108);
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

  it("does not let a cheap late supplier always win", () => {
    const results = scoreSuppliers([
      row({ supplier: "Cheap Late", priceOriginal: "$180", leadTimeDays: 60, availableQuantity: 100 }),
      row({ supplier: "Ready Supplier", priceOriginal: "$205", leadTimeDays: 3, availableQuantity: 100 }),
    ], { product: "Maize", quantity: 50, requiredDate: "2026-08-20", maxPrice: 220 });
    expect(results.find((result) => result.rank === 1)?.supplier).toBe("Ready Supplier");
    expect(results.find((result) => result.supplier === "Cheap Late")?.flags.join(" ")).toContain("misses required date");
  });

  it("flags low quantity and above max price", () => {
    const [result] = scoreSuppliers([row({ priceOriginal: "$260", availableQuantity: 20 })], { product: "Maize", quantity: 50, maxPrice: 240 });
    expect(result.flags.join(" ")).toContain("Split order suggestion");
    expect(result.flags.join(" ")).toContain("above max price");
  });

  it("ranks the supplier matching request country risk and reliability higher", () => {
    const results = scoreSuppliers([
      row({ supplier: "Mismatch", country: "India", countryRisk: "High", reliability: 60, tier: "Trading Company", availableQuantity: 100, leadTimeDays: 5 }),
      row({ supplier: "Match", country: "Bangladesh", countryRisk: "Medium", reliability: 85, tier: "Local", availableQuantity: 100, leadTimeDays: 5 }),
    ], { product: "Maize", quantity: 50, preferredCountry: "Bangladesh", riskTolerance: "Medium", minReliability: 80, supplierTypePreference: "Local" });
    expect(results.find((result) => result.rank === 1)?.supplier).toBe("Match");
  });

  it("lowers confidence when quote data is missing", () => {
    const [result] = scoreSuppliers([row()], { product: "Maize", quantity: 50 });
    expect(result.confidence).toBeLessThan(60);
    expect(result.flags.join(" ")).toContain("Missing lead time");
  });

  it("flags product spec mismatch", () => {
    const [result] = scoreSuppliers([row({ moisture: "16%" })], { product: "Maize", moisture: "14%" });
    expect(result.flags.join(" ")).toContain("moisture does not match");
  });

  it("blocks blacklisted supplier from top rank", () => {
    const results = scoreSuppliers([
      row({ supplier: "Bad Supplier", priceOriginal: "$100" }),
      row({ row: 3, supplier: "Good Supplier", priceOriginal: "$210" }),
    ], { product: "Maize", supplierPerformance: { "bad supplier": { watchStatus: "blacklist" } } });
    expect(results.find((result) => result.supplier === "Bad Supplier")?.score).toBe(0);
    expect(results.find((result) => result.rank === 1)?.supplier).toBe("Good Supplier");
  });

  it("never assigns a rank to a blacklisted supplier", () => {
    const [result] = scoreSuppliers([row()], { supplierPerformance: { "supplier a": { watchStatus: "blacklist" } } });
    expect(result.rank).toBeUndefined();
  });

  it("uses delivery terms when a delivery location is requested", () => {
    const [result] = scoreSuppliers([row({ deliveryTerms: "Warehouse delivery" })], { deliveryLocation: "Dhaka warehouse" });
    expect(result.flags).toContain("Delivery terms do not name Dhaka warehouse");
  });

  it("penalizes poor supplier performance", () => {
    const results = scoreSuppliers([
      row({ supplier: "Late Supplier" }),
      row({ row: 3, supplier: "Clean Supplier" }),
    ], { supplierPerformance: { "late supplier": { lateDeliveries: 5, rejectedShipments: 1, priceAccuracy: 70, documentAccuracy: 70 }, "clean supplier": { priceAccuracy: 95, documentAccuracy: 95 } } });
    expect(results.find((result) => result.rank === 1)?.supplier).toBe("Clean Supplier");
  });

  it("missing import documents lowers confidence", () => {
    const [result] = scoreSuppliers([row({ country: "Brazil", documentsAvailable: "CO" })], { product: "Maize" });
    expect(result.flags.join(" ")).toContain("Missing document");
    expect(result.confidence).toBeLessThan(80);
  });

  it("keeps split order suggestion as a first-class field", () => {
    const [result] = scoreSuppliers([row({ availableQuantity: 20 })], { product: "Maize", quantity: 50 });
    expect(result.splitSuggestion).toContain("Supplier A: 20");
  });
});

it("calculates landed cost without model arithmetic", () => {
  expect(landedCost(200, 30, 1, 5, 8)).toBe(250);
  expect(landedCost(200, 30, 1, 5, 8, 2, 10, 12)).toBe(516.4);
  expect(landedCostByTerm(200, "CIF Chattogram", 30, 1, 5, 8)).toBe(218);
  expect(landedCostByTerm(200, "Local delivery", 30, 1, 5, 8, 1, 0, 12)).toBe(212);
});
