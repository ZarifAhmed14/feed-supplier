import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/lib/ingest";

describe("CSV parser", () => {
  it("handles quoted commas, escaped quotes and line endings", () => {
    expect(parseCsv('supplier,ingredient,price\r\n"A, Ltd","Maize","$200"\r\n"B ""Feeds""",Soy,"$210-$220"')).toEqual([
      ["supplier", "ingredient", "price"],
      ["A, Ltd", "Maize", "$200"],
      ['B "Feeds"', "Soy", "$210-$220"],
    ]);
  });

  it("rejects unclosed quoted fields", () => {
    expect(() => parseCsv('supplier,ingredient\n"A,Maize')).toThrow("unclosed quoted field");
  });
});
