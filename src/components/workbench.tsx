"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadState, saveState } from "@/lib/browser-db";
import { importFile, SAMPLE_ROWS, type ImportResult } from "@/lib/ingest";
import { landedCost, scoreSuppliers, type ScoreResult, type SupplierInput } from "@/lib/procurement";
import { addSupplier, archiveSupplier, SEED_SUPPLIERS, supplierKey, type SupplierProfile } from "@/lib/suppliers";

type Scenario = { freight: number; insurance: number; duty: number; vat: number; charges: number; fxRate: number; inlandTransport: number };
type PurchaseRequest = { product: string; quantity: string; unit: string; requiredDate: string; deliveryLocation: string };
type Approval = { key: string; supplier: string; ingredient: string; approvedAt: string };
type AppState = { rows: SupplierInput[]; suppliers: SupplierProfile[]; request: PurchaseRequest; scenario: Scenario; approval?: Approval; audit: string[]; docs: Record<string, boolean>; orderStatus: string };

const LOCAL_DOCS = ["Quotation", "Comparative statement", "Approval note", "Purchase Order", "Delivery challan", "Invoice", "QC report", "Warehouse receive note"];
const IMPORT_DOCS = ["Proforma Invoice", "Purchase Order", "LC/payment docs", "Commercial Invoice", "Packing List", "Bill of Lading / Airway Bill", "Certificate of Origin", "Insurance", "HS code", "Customs docs", "Warehouse receive note"];
const ORDER_STATUSES = ["Draft", "RFQ sent", "Quotes received", "Approved", "PO sent", "Supplier confirmed", "In transit", "Customs clearance", "Warehouse received", "Closed"];

const escapeCsv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function Workbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<SupplierInput[]>([]);
  const [importMeta, setImportMeta] = useState<ImportResult>();
  const [fileName, setFileName] = useState("No file loaded");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<Scenario>({ freight: 38, insurance: 0.5, duty: 5, vat: 0, charges: 12, fxRate: 1, inlandTransport: 0 });
  const [supplierError, setSupplierError] = useState("");
  const [supplierForm, setSupplierForm] = useState({ name: "", product: "", country: "", email: "", phone: "" });
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>(SEED_SUPPLIERS);
  const [request, setRequest] = useState<PurchaseRequest>({ product: "", quantity: "", unit: "MT", requiredDate: "", deliveryLocation: "" });
  const [quoteError, setQuoteError] = useState("");
  const [quoteForm, setQuoteForm] = useState({ supplier: "", ingredient: "", price: "", currency: "USD", unit: "per MT", tier: "", availability: "", country: "", countryRisk: "", reliability: "" });
  const [approval, setApproval] = useState<Approval>();
  const [audit, setAudit] = useState<string[]>([]);
  const [docs, setDocs] = useState<Record<string, boolean>>({});
  const [orderStatus, setOrderStatus] = useState(ORDER_STATUSES[0]);
  const [hydrated, setHydrated] = useState(false);
  const results = useMemo(() => scoreSuppliers(rows), [rows]);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active");
  const knownSuppliers = new Set(activeSuppliers.map((supplier) => supplierKey(supplier.name)));
  const approvedResult = approval ? results.find((result) => resultKey(result) === approval.key) : undefined;
  const selectedDocs = approvedResult?.country?.toLowerCase().includes("bangladesh") ? LOCAL_DOCS : IMPORT_DOCS;
  const poDraft = approvedResult ? [
    `PURCHASE ORDER`,
    ``,
    `Supplier: ${approvedResult.supplier}`,
    `Product: ${approvedResult.ingredient}`,
    `Quantity: ${request.quantity || "[quantity]"} ${request.unit || ""}`.trim(),
    `Unit price: ${approvedResult.priceOriginal || "[price]"}`,
    `Delivery location: ${request.deliveryLocation || "[delivery location]"}`,
    `Required date: ${request.requiredDate || "[required date]"}`,
    `Status: Draft - human review required`,
  ].join("\n") : "Approve a supplier to generate PO draft.";
  const rfqDraft = [
    `Dear Supplier,`,
    ``,
    `Please quote for the following purchase request:`,
    `Product: ${request.product || "[product]"}`,
    `Quantity: ${request.quantity || "[quantity]"} ${request.unit || ""}`.trim(),
    `Required date: ${request.requiredDate || "[required date]"}`,
    `Delivery location: ${request.deliveryLocation || "[delivery location]"}`,
    ``,
    `Please include unit price, currency, MOQ, lead time, payment terms, delivery terms, quotation validity, and available documents.`,
    ``,
    `Regards,`,
    `Procurement Team`,
  ].join("\n");

  useEffect(() => {
    loadState<AppState>().then((saved) => {
      if (!saved) return;
      setRows(saved.rows ?? []);
      setSuppliers(saved.suppliers ?? SEED_SUPPLIERS);
      setRequest((current) => saved.request ?? current);
      setScenario((current) => saved.scenario ?? current);
      setApproval(saved.approval);
      setAudit(saved.audit ?? []);
      setDocs(saved.docs ?? {});
      setOrderStatus(saved.orderStatus ?? ORDER_STATUSES[0]);
      setFileName(saved.rows?.length ? "Saved local data" : "No file loaded");
    }).finally(() => setHydrated(true));
    // ponytail: one app-state blob in IndexedDB; split stores if multi-user/server sync matters.
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void saveState<AppState>({ rows, suppliers, request, scenario, approval, audit, docs, orderStatus });
  }, [approval, audit, docs, hydrated, orderStatus, request, rows, scenario, suppliers]);

  async function loadFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const imported = await importFile(file);
      if (!imported.rows.length) throw new Error("No valid supplier rows were found.");
      setRows(imported.rows);
      setImportMeta(imported);
      setFileName(file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The file could not be read.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function loadSample() {
    setRows(SAMPLE_ROWS);
    setImportMeta({ rows: SAMPLE_ROWS, rejected: [], sheets: ["Sample"] });
    setFileName("Sample supplier quotes");
    setError("");
  }

  function exportAudit() {
    const headers = ["engine_version", "source", "row", "supplier", "ingredient", "price_original", "midpoint", "currency", "unit", "score", "rank", "completeness", "flags"];
    const csv = [headers, ...results.map((result) => ["1", result.source, result.row, result.supplier, result.ingredient, result.priceOriginal, result.midpoint, result.currency, result.unit, result.score, result.rank, result.completeness, result.flags.join("; ")])]
      .map((record) => record.map(escapeCsv).join(","))
      .join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "procurement-analysis-audit.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function saveSupplier() {
    const next = addSupplier(suppliers, supplierForm);
    setSuppliers(next.suppliers);
    setSupplierError(next.error);
    if (!next.error) setSupplierForm({ name: "", product: "", country: "", email: "", phone: "" });
  }

  function addManualQuote() {
    if (!quoteForm.supplier.trim() || !quoteForm.ingredient.trim()) {
      setQuoteError("Supplier and ingredient are required.");
      return;
    }
    setRows((current) => [...current, {
      source: "Manual",
      row: current.filter((row) => row.source === "Manual").length + 1,
      supplier: quoteForm.supplier.trim(),
      ingredient: quoteForm.ingredient.trim(),
      priceOriginal: quoteForm.price.trim() || undefined,
      currency: quoteForm.currency.trim().toUpperCase() || undefined,
      unit: quoteForm.unit.trim() || undefined,
      tier: quoteForm.tier.trim() || undefined,
      availability: quoteForm.availability.trim() || undefined,
      country: quoteForm.country.trim() || undefined,
      countryRisk: quoteForm.countryRisk.trim() || undefined,
      reliability: quoteForm.reliability.trim() ? Number(quoteForm.reliability) : undefined,
    }]);
    setImportMeta((current) => ({ rows: [], rejected: current?.rejected ?? [], sheets: [...new Set([...(current?.sheets ?? []), "Manual"])] }));
    setFileName("Manual quote entry");
    setQuoteError("");
    setQuoteForm({ supplier: "", ingredient: request.product, price: "", currency: "USD", unit: "per MT", tier: "", availability: "", country: "", countryRisk: "", reliability: "" });
  }

  function resultKey(result: ScoreResult) {
    return `${result.source}-${result.row}-${result.supplier}-${result.ingredient}`;
  }

  function approve(result: ScoreResult) {
    const next = { key: resultKey(result), supplier: result.supplier, ingredient: result.ingredient, approvedAt: new Date().toISOString() };
    setApproval(next);
    setOrderStatus("Approved");
    setAudit((current) => [`Approved ${result.supplier} for ${result.ingredient}`, ...current]);
  }

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <p className="label">Skeleton product</p>
          <h1>Supplier Quote Analyzer</h1>
          <p>Build the working procurement flow first. UI polish later.</p>
        </div>
        <strong>JOGAN</strong>
      </header>

      <section className="card">
        <h2>1. Purchase request</h2>
        <div className="fields">
          <label>Product / ingredient<input value={request.product} onChange={(event) => setRequest({ ...request, product: event.target.value })} /></label>
          <label>Quantity<input type="number" min="0" value={request.quantity} onChange={(event) => setRequest({ ...request, quantity: event.target.value })} /></label>
          <label>Unit<input value={request.unit} onChange={(event) => setRequest({ ...request, unit: event.target.value })} /></label>
          <label>Required date<input type="date" value={request.requiredDate} onChange={(event) => setRequest({ ...request, requiredDate: event.target.value })} /></label>
          <label>Delivery location<input value={request.deliveryLocation} onChange={(event) => setRequest({ ...request, deliveryLocation: event.target.value })} /></label>
        </div>
        <p className="muted">
          Request: {request.product || "No product"} · {request.quantity || "No quantity"} {request.unit || ""} · {request.requiredDate || "No date"} · {request.deliveryLocation || "No delivery location"}
        </p>
      </section>

      <section className="card">
        <h2>2. Load quote data</h2>
        <div className="actions">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Reading file..." : "Upload Excel/CSV"}
          </button>
          <button type="button" onClick={loadSample}>Use sample data</button>
          <button type="button" onClick={exportAudit} disabled={!results.length}>Export audit CSV</button>
        </div>
        <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.csv" onChange={(event) => loadFile(event.target.files?.[0])} />
        <p className="muted">Current file: {fileName}</p>
        <p className="muted">Required columns: supplier, ingredient. Useful: price, currency, unit, tier, availability, country risk, reliability.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="card">
        <div className="table-head">
          <h2>3. Supplier database</h2>
          <p>{activeSuppliers.length} active supplier(s)</p>
        </div>
        <div className="fields">
          <label>Name<input value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} /></label>
          <label>Product<input value={supplierForm.product} onChange={(event) => setSupplierForm({ ...supplierForm, product: event.target.value })} /></label>
          <label>Country<input value={supplierForm.country} onChange={(event) => setSupplierForm({ ...supplierForm, country: event.target.value })} /></label>
          <label>Email<input type="email" value={supplierForm.email} onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })} /></label>
          <label>Phone<input value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></label>
        </div>
        <div className="actions row-gap">
          <button type="button" onClick={saveSupplier}>Add supplier</button>
        </div>
        {supplierError && <p className="error" role="alert">{supplierError}</p>}
        <div className="table-wrap compact">
          <table>
            <thead><tr><th>Name</th><th>Product</th><th>Country</th><th>Contact</th><th>Action</th></tr></thead>
            <tbody>
              {activeSuppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>{supplier.name}</td>
                  <td>{supplier.product || "-"}</td>
                  <td>{supplier.country || "-"}</td>
                  <td>{supplier.email || supplier.phone || "-"}</td>
                  <td><button type="button" onClick={() => setSuppliers(archiveSupplier(suppliers, supplier.id))}>Archive</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>4. Manual quote entry</h2>
        <p className="muted">Use this for phone, SMS, or WhatsApp quotes.</p>
        <div className="fields">
          <label>Supplier<input value={quoteForm.supplier} onChange={(event) => setQuoteForm({ ...quoteForm, supplier: event.target.value })} /></label>
          <label>Ingredient<input value={quoteForm.ingredient} onChange={(event) => setQuoteForm({ ...quoteForm, ingredient: event.target.value })} /></label>
          <label>Price<input value={quoteForm.price} onChange={(event) => setQuoteForm({ ...quoteForm, price: event.target.value })} /></label>
          <label>Currency<input value={quoteForm.currency} onChange={(event) => setQuoteForm({ ...quoteForm, currency: event.target.value })} /></label>
          <label>Unit<input value={quoteForm.unit} onChange={(event) => setQuoteForm({ ...quoteForm, unit: event.target.value })} /></label>
          <label>Tier<input value={quoteForm.tier} onChange={(event) => setQuoteForm({ ...quoteForm, tier: event.target.value })} /></label>
          <label>Availability<input value={quoteForm.availability} onChange={(event) => setQuoteForm({ ...quoteForm, availability: event.target.value })} /></label>
          <label>Country<input value={quoteForm.country} onChange={(event) => setQuoteForm({ ...quoteForm, country: event.target.value })} /></label>
          <label>Country risk<input value={quoteForm.countryRisk} onChange={(event) => setQuoteForm({ ...quoteForm, countryRisk: event.target.value })} /></label>
          <label>Reliability<input type="number" min="0" max="100" value={quoteForm.reliability} onChange={(event) => setQuoteForm({ ...quoteForm, reliability: event.target.value })} /></label>
        </div>
        <div className="actions row-gap">
          <button type="button" onClick={addManualQuote}>Add quote</button>
        </div>
        {quoteError && <p className="error" role="alert">{quoteError}</p>}
      </section>

      <section className="card">
        <h2>5. RFQ draft</h2>
        <p className="muted">Copy this message and send manually. Email/SMS automation comes later.</p>
        <textarea className="rfq" readOnly value={rfqDraft} aria-label="RFQ draft" />
      </section>

      <section className="card">
        <h2>6. Cost assumptions</h2>
        <div className="fields">
          <label>Freight / unit<input type="number" min="0" value={scenario.freight} onChange={(event) => setScenario({ ...scenario, freight: Number(event.target.value) })} /></label>
          <label>Insurance %<input type="number" min="0" step="0.1" value={scenario.insurance} onChange={(event) => setScenario({ ...scenario, insurance: Number(event.target.value) })} /></label>
          <label>Duty %<input type="number" min="0" step="0.1" value={scenario.duty} onChange={(event) => setScenario({ ...scenario, duty: Number(event.target.value) })} /></label>
          <label>VAT %<input type="number" min="0" step="0.1" value={scenario.vat} onChange={(event) => setScenario({ ...scenario, vat: Number(event.target.value) })} /></label>
          <label>FX rate<input type="number" min="0" step="0.01" value={scenario.fxRate} onChange={(event) => setScenario({ ...scenario, fxRate: Number(event.target.value) })} /></label>
          <label>Other charges<input type="number" min="0" value={scenario.charges} onChange={(event) => setScenario({ ...scenario, charges: Number(event.target.value) })} /></label>
          <label>Inland transport<input type="number" min="0" value={scenario.inlandTransport} onChange={(event) => setScenario({ ...scenario, inlandTransport: Number(event.target.value) })} /></label>
        </div>
      </section>

      <section className="card">
        <div className="table-head">
          <h2>7. Ranking result</h2>
          <p>{results.length} valid row(s), {importMeta?.rejected.length ?? 0} rejected</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Supplier</th>
                <th>Ingredient</th>
                <th>Quote</th>
                <th>Score</th>
                <th>Completeness</th>
                <th>Scenario cost</th>
                <th>Warnings</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {results.length ? results.map((result) => (
                <tr key={`${result.source}-${result.row}`}>
                  <td>{result.rank ? `#${result.rank}` : "-"}</td>
                  <td>{result.supplier}<small>{knownSuppliers.has(supplierKey(result.supplier)) ? "Existing supplier" : "New/unmatched supplier"} · {result.country || "No country"}</small></td>
                  <td>{result.ingredient}<small>{result.tier || "No tier"}</small></td>
                  <td>{result.priceOriginal || "Missing"}<small>{result.currency && result.unit ? `${result.currency} / ${result.unit}` : "Missing unit/currency"}</small></td>
                  <td>{result.score?.toFixed(1) ?? "N/A"}</td>
                  <td>{result.completeness.toFixed(0)}%</td>
                  <td>{result.midpoint === undefined ? "N/A" : `${landedCost(result.midpoint, scenario.freight, scenario.insurance, scenario.duty, scenario.charges, scenario.fxRate, scenario.vat, scenario.inlandTransport).toFixed(2)} ${result.currency ?? ""}`}</td>
                  <td>{result.flags.join("; ") || "OK"}</td>
                  <td><button type="button" onClick={() => approve(result)}>{approval?.key === resultKey(result) ? "Approved" : "Approve"}</button></td>
                </tr>
              )) : (
                <tr><td colSpan={9}>Load a quote file or use sample data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>8. Approval, PO, documents, tracking</h2>
        <p className="muted">Approved supplier: {approval ? `${approval.supplier} for ${approval.ingredient}` : "None"}</p>
        <div className="fields">
          <label>Order status<select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>{ORDER_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
        <h3>PO draft</h3>
        <textarea className="rfq" readOnly value={poDraft} aria-label="PO draft" />
        <h3>Document checklist</h3>
        <div className="checklist">
          {selectedDocs.map((doc) => (
            <label key={doc}><input type="checkbox" checked={Boolean(docs[doc])} onChange={(event) => setDocs({ ...docs, [doc]: event.target.checked })} /> {doc}</label>
          ))}
        </div>
        <h3>Audit trail</h3>
        <ul>{audit.length ? audit.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>No approvals yet.</li>}</ul>
      </section>

      {importMeta && importMeta.rejected.length > 0 && (
        <section className="card">
          <h2>Rejected rows</h2>
          <ul>{importMeta.rejected.map((item) => <li key={`${item.source}-${item.row}`}>{item.source}, row {item.row}: {item.reason}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
