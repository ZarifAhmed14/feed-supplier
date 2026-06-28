import { describe, expect, it } from "vitest";
import { addSupplier, archiveSupplier, SEED_SUPPLIERS } from "../src/lib/suppliers";

describe("supplier database helpers", () => {
  it("adds suppliers and blocks active duplicates", () => {
    const added = addSupplier(SEED_SUPPLIERS, { name: "New Supplier", product: "Maize", country: "Bangladesh" });
    expect(added.error).toBe("");
    expect(added.suppliers).toHaveLength(SEED_SUPPLIERS.length + 1);

    const duplicate = addSupplier(added.suppliers, { name: " new supplier ", product: "Maize", country: "Bangladesh" });
    expect(duplicate.error).toBe("Supplier already exists.");
  });

  it("archives suppliers", () => {
    const archived = archiveSupplier(SEED_SUPPLIERS, SEED_SUPPLIERS[0].id);
    expect(archived[0].status).toBe("archived");
  });
});
