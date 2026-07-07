import type { SupplierInput } from "./procurement";

export type ImportResult = {
  rows: SupplierInput[];
  rejected: { source: string; row: number; reason: string }[];
  sheets: string[];
};

type Cell = string | number | boolean | Date | null;

const aliases: Record<keyof Omit<SupplierInput, "source" | "row">, string[]> = {
  supplier: ["supplier", "supplier name", "vendor", "company"],
  ingredient: ["ingredient", "ingredient category", "category", "product"],
  priceOriginal: ["price", "price range", "quote", "quoted price"],
  currency: ["currency", "curr"],
  unit: ["unit", "uom", "price unit"],
  tier: ["tier", "supplier tier"],
  availability: ["availability", "stock status"],
  country: ["country", "origin", "supplier country"],
  countryRisk: ["country risk", "risk"],
  reliability: ["reliability", "supply reliability", "reliability score"],
  moq: ["moq", "minimum order quantity", "minimum quantity"],
  availableQuantity: ["available quantity", "available qty", "stock quantity", "capacity"],
  leadTimeDays: ["lead time", "lead time days", "delivery days"],
  quoteValidityDate: ["quote validity", "valid until", "validity date"],
  paymentTerms: ["payment terms"],
  deliveryTerms: ["delivery terms", "incoterm", "incoterms"],
  qualitySpec: ["quality spec", "specification", "quality"],
  documentsAvailable: ["documents available", "documents", "certificates"],
  moisture: ["moisture"],
  protein: ["protein"],
  origin: ["origin", "product origin"],
  grade: ["grade"],
  packaging: ["packaging", "packing"],
  qcNote: ["qc requirement", "qc note", "qc result"],
};

const normalizeHeader = (value: Cell) => String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeTables(tables: { sheet: string; data: Cell[][] }[]): ImportResult {
  const result: ImportResult = { rows: [], rejected: [], sheets: tables.map((table) => table.sheet) };

  for (const table of tables) {
    if (table.data.length < 2) {
      result.rejected.push({ source: table.sheet, row: 1, reason: "Sheet has no data rows" });
      continue;
    }
    const headers = table.data[0].map(normalizeHeader);
    const indexes = Object.fromEntries(
      Object.entries(aliases).map(([field, names]) => [field, headers.findIndex((header) => names.includes(header))]),
    ) as Record<keyof Omit<SupplierInput, "source" | "row">, number>;

    if (indexes.supplier < 0 || indexes.ingredient < 0) {
      result.rejected.push({ source: table.sheet, row: 1, reason: "Required supplier or ingredient column not found" });
      continue;
    }

    table.data.slice(1).forEach((cells, index) => {
      const read = (field: keyof typeof indexes) => {
        const position = indexes[field];
        return position < 0 ? undefined : cells[position];
      };
      const supplier = String(read("supplier") ?? "").trim();
      const ingredient = String(read("ingredient") ?? "").trim();
      if (!supplier || !ingredient) {
        result.rejected.push({ source: table.sheet, row: index + 2, reason: "Supplier and ingredient are required" });
        return;
      }
      const reliabilityValue = read("reliability");
      const moqValue = read("moq");
      const availableValue = read("availableQuantity");
      const leadTimeValue = read("leadTimeDays");
      result.rows.push({
        source: table.sheet,
        row: index + 2,
        supplier,
        ingredient,
        priceOriginal: String(read("priceOriginal") ?? "").trim() || undefined,
        currency: String(read("currency") ?? "").trim().toUpperCase() || undefined,
        unit: String(read("unit") ?? "").trim() || undefined,
        tier: String(read("tier") ?? "").trim() || undefined,
        availability: String(read("availability") ?? "").trim() || undefined,
        country: String(read("country") ?? "").trim() || undefined,
        countryRisk: read("countryRisk") === undefined ? undefined : String(read("countryRisk")).trim(),
        reliability:
          reliabilityValue === undefined || reliabilityValue === null || reliabilityValue === ""
            ? undefined
            : Number(reliabilityValue),
        moq: moqValue === undefined || moqValue === null || moqValue === "" ? undefined : Number(moqValue),
        availableQuantity: availableValue === undefined || availableValue === null || availableValue === "" ? undefined : Number(availableValue),
        leadTimeDays: leadTimeValue === undefined || leadTimeValue === null || leadTimeValue === "" ? undefined : Number(leadTimeValue),
        quoteValidityDate: String(read("quoteValidityDate") ?? "").trim() || undefined,
        paymentTerms: String(read("paymentTerms") ?? "").trim() || undefined,
        deliveryTerms: String(read("deliveryTerms") ?? "").trim() || undefined,
        qualitySpec: String(read("qualitySpec") ?? "").trim() || undefined,
        documentsAvailable: String(read("documentsAvailable") ?? "").trim() || undefined,
        moisture: String(read("moisture") ?? "").trim() || undefined,
        protein: String(read("protein") ?? "").trim() || undefined,
        origin: String(read("origin") ?? "").trim() || undefined,
        grade: String(read("grade") ?? "").trim() || undefined,
        packaging: String(read("packaging") ?? "").trim() || undefined,
        qcNote: String(read("qcNote") ?? "").trim() || undefined,
      });
    });
  }
  return result;
}

export async function importFile(file: File): Promise<ImportResult> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (!extension || !["csv", "xlsx"].includes(extension)) throw new Error("Only .csv and .xlsx files are accepted.");
  if (file.size > 5 * 1024 * 1024) throw new Error("File exceeds the 5 MB limit.");

  if (extension === "csv") {
    const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new Error("File content does not match its .csv extension.");
    const data = parseCsv(await file.text());
    if (data.length > 5001) throw new Error("CSV exceeds the limit of 5,000 rows.");
    return normalizeTables([{ sheet: file.name, data }]);
  }

  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error("File content does not match its .xlsx extension.");
  const readXlsxFile = (await import("read-excel-file/browser")).default;
  const sheets = await readXlsxFile(file);
  if (sheets.length > 25 || sheets.reduce((count, sheet) => count + sheet.data.length, 0) > 5001) {
    throw new Error("Workbook exceeds the limit of 25 sheets or 5,000 rows.");
  }
  return normalizeTables(sheets.map(({ sheet, data }) => ({ sheet, data: data as Cell[][] })));
}

export const SAMPLE_ROWS: SupplierInput[] = [
  { source: "Sample", row: 2, supplier: "Delta Agro", ingredient: "Soybean Meal", priceOriginal: "$470-$490", currency: "USD", unit: "per MT", tier: "Regional", availability: "In stock", country: "Bangladesh", countryRisk: "Medium", reliability: 82, moq: 20, availableQuantity: 120, leadTimeDays: 8, quoteValidityDate: "2026-07-20", paymentTerms: "30% advance", deliveryTerms: "CFR Chattogram", documentsAvailable: "CO, invoice, QC report", moisture: "12%", protein: "46%", origin: "Bangladesh", grade: "Feed grade", packaging: "50kg bag", qcNote: "QC passed" },
  { source: "Sample", row: 3, supplier: "Meghna Nutrition", ingredient: "Soybean Meal", priceOriginal: "$455", currency: "USD", unit: "per MT", tier: "Local", availability: "Limited", country: "Bangladesh", countryRisk: "Medium", reliability: 74, moq: 10, availableQuantity: 40, leadTimeDays: 4, quoteValidityDate: "2026-07-12", paymentTerms: "Cash", deliveryTerms: "Warehouse delivery", documentsAvailable: "Invoice", moisture: "13%", protein: "44%", origin: "Bangladesh", grade: "Standard", packaging: "Loose", qcNote: "QC pending" },
  { source: "Sample", row: 4, supplier: "Atlas Commodities", ingredient: "Soybean Meal", priceOriginal: "$505", currency: "USD", unit: "per MT", tier: "International Manufacturer", availability: "Readily available", country: "Brazil", countryRisk: "Low", reliability: 91, moq: 100, availableQuantity: 500, leadTimeDays: 35, quoteValidityDate: "2026-08-01", paymentTerms: "LC", deliveryTerms: "CFR Chattogram", documentsAvailable: "CO, BL, insurance, invoice, QC report", moisture: "12%", protein: "47%", origin: "Brazil", grade: "Hi-pro", packaging: "Bulk", qcNote: "COA available" },
  { source: "Sample", row: 5, supplier: "Padma Feed Inputs", ingredient: "Maize", priceOriginal: "$245-$255", currency: "USD", unit: "per MT", tier: "Local", availability: "Seasonal", country: "Bangladesh", countryRisk: "Medium", reliability: 79, moq: 5, availableQuantity: 80, leadTimeDays: 3, quoteValidityDate: "2026-07-13", paymentTerms: "Cash", deliveryTerms: "Warehouse delivery", documentsAvailable: "Invoice, QC report", moisture: "14%", protein: "8%", origin: "Bangladesh", grade: "Feed grade", packaging: "50kg bag", qcNote: "Aflatoxin checked" },
  { source: "Sample", row: 6, supplier: "Eastern Grain Co.", ingredient: "Maize", priceOriginal: "$260", currency: "USD", unit: "per MT", tier: "Regional", availability: "In stock", country: "India", countryRisk: "Medium", reliability: 86, moq: 20, availableQuantity: 200, leadTimeDays: 10, quoteValidityDate: "2026-07-25", paymentTerms: "TT", deliveryTerms: "CPT Dhaka", documentsAvailable: "CO, invoice", moisture: "13%", protein: "9%", origin: "India", grade: "Feed grade", packaging: "Bulk", qcNote: "QC report pending" },
];
