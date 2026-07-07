export type SupplierProfile = {
  id: string;
  name: string;
  product: string;
  country: string;
  email?: string;
  phone?: string;
  lateDeliveries?: number;
  rejectedShipments?: number;
  priceAccuracy?: number;
  documentAccuracy?: number;
  watchStatus?: "clear" | "watchlist" | "blacklist";
  status: "active" | "archived";
};

export const SEED_SUPPLIERS: SupplierProfile[] = [
  { id: "delta-agro", name: "Delta Agro", product: "Soybean Meal", country: "Bangladesh", email: "sales@delta.example", phone: "+8801700000001", lateDeliveries: 1, rejectedShipments: 0, priceAccuracy: 92, documentAccuracy: 88, watchStatus: "clear", status: "active" },
  { id: "atlas-commodities", name: "Atlas Commodities", product: "Soybean Meal", country: "Brazil", email: "trade@atlas.example", lateDeliveries: 0, rejectedShipments: 0, priceAccuracy: 95, documentAccuracy: 94, watchStatus: "clear", status: "active" },
];

export const supplierKey = (name: string) => name.trim().toLowerCase();

export function addSupplier(suppliers: SupplierProfile[], supplier: Omit<SupplierProfile, "id" | "status">) {
  const name = supplier.name.trim();
  if (!name) return { suppliers, error: "Supplier name is required." };
  if (suppliers.some((item) => supplierKey(item.name) === supplierKey(name) && item.status === "active")) {
    return { suppliers, error: "Supplier already exists." };
  }
  return {
    suppliers: [...suppliers, { ...supplier, id: `${supplierKey(name).replaceAll(/\s+/g, "-")}-${Date.now()}`, name, status: "active" as const }],
    error: "",
  };
}

export function archiveSupplier(suppliers: SupplierProfile[], id: string) {
  return suppliers.map((supplier) => supplier.id === id ? { ...supplier, status: "archived" as const } : supplier);
}
