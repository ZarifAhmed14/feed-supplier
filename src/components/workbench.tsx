"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadState, saveState } from "@/lib/browser-db";
import { importFile, SAMPLE_ROWS, type ImportResult } from "@/lib/ingest";
import { landedCostByTerm, parsePrice, scoreSuppliers, type RequestFit, type ScoreResult, type SupplierInput } from "@/lib/procurement";
import { addSupplier, archiveSupplier, SEED_SUPPLIERS, supplierKey, type SupplierProfile } from "@/lib/suppliers";

type Scenario = { freight: number; insurance: number; duty: number; vat: number; charges: number; fxRate: number; inlandTransport: number };
type PurchaseRequest = { product: string; quantity: string; unit: string; requiredDate: string; deliveryLocation: string; lowPrice: string; desiredPrice: string; maxPrice: string; preferredCountry: string; riskTolerance: string; minReliability: string; supplierTypePreference: string; moisture: string; protein: string; origin: string; grade: string; packaging: string; qcRequirement: string };
type Approval = { key: string; supplier: string; ingredient: string; approvedAt: string; reason?: string };
type AppState = { rows: SupplierInput[]; suppliers: SupplierProfile[]; request: PurchaseRequest; scenario: Scenario; approval?: Approval; audit: string[]; agentLog: string[]; docs: Record<string, boolean>; orderStatus: string };

const LOCAL_DOCS = ["Quotation", "Comparative statement", "Approval note", "Purchase Order", "Delivery challan", "Invoice", "QC report", "Warehouse receive note"];
const IMPORT_DOCS = ["Proforma Invoice", "Purchase Order", "LC/payment docs", "Commercial Invoice", "Packing List", "Bill of Lading / Airway Bill", "Certificate of Origin", "Insurance", "HS code", "Customs docs", "Warehouse receive note"];
const ORDER_STATUSES = ["Draft", "RFQ sent", "Prices received", "Approved", "PO sent", "Supplier confirmed", "In transit", "Customs clearance", "Warehouse received", "Closed"];
const STEPS = ["Need", "Supplier prices", "Recommendation", "Approval", "PO & tracking"];
const PRODUCTS = ["Maize", "Soybean Meal", "Rice Bran", "Wheat Bran", "Fish Meal", "DCP", "Limestone", "Salt", "Premix"];
const UNITS = ["MT", "KG", "Bag", "Carton", "Liter", "Gram", "Pound", "Ton", "Container", "Truckload"];
const PRICE_UNITS = UNITS.map((unit) => `per ${unit}`);
const CURRENCIES = ["USD", "BDT", "INR", "CNY", "EUR"];
const COUNTRIES = ["Bangladesh", "India", "China", "Brazil", "USA", "Vietnam", "Thailand"];
const RISK_LEVELS = ["Low", "Medium", "High"];
const SUPPLIER_TYPES = ["Local", "Regional", "Trading Company", "International Manufacturer", "Global MNC"];
const PRODUCT_PRICE_GUIDES: Record<string, { low: number; desired: number; max: number; min: number; ceiling: number }> = {
  Maize: { low: 235, desired: 245, max: 260, min: 210, ceiling: 320 },
  "Soybean Meal": { low: 435, desired: 455, max: 490, min: 390, ceiling: 580 },
  "Rice Bran": { low: 160, desired: 170, max: 190, min: 130, ceiling: 240 },
  "Wheat Bran": { low: 170, desired: 180, max: 205, min: 140, ceiling: 260 },
  "Fish Meal": { low: 1100, desired: 1180, max: 1280, min: 900, ceiling: 1600 },
  DCP: { low: 500, desired: 520, max: 570, min: 430, ceiling: 700 },
  Limestone: { low: 35, desired: 42, max: 55, min: 25, ceiling: 90 },
  Salt: { low: 58, desired: 65, max: 80, min: 40, ceiling: 120 },
  Premix: { low: 2050, desired: 2200, max: 2500, min: 1600, ceiling: 3200 },
};

const escapeCsv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function Workbench() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<SupplierInput[]>([]);
  const [importMeta, setImportMeta] = useState<ImportResult>();
  const [fileName, setFileName] = useState("No file loaded");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<Scenario>({ freight: 38, insurance: 0.5, duty: 5, vat: 0, charges: 12, fxRate: 1, inlandTransport: 0 });
  const [supplierError, setSupplierError] = useState("");
  const [supplierForm, setSupplierForm] = useState({ name: "", product: "", country: "", email: "", phone: "", lateDeliveries: "", rejectedShipments: "", priceAccuracy: "", documentAccuracy: "", watchStatus: "clear" });
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>(SEED_SUPPLIERS);
  const [request, setRequest] = useState<PurchaseRequest>({ product: "", quantity: "", unit: "MT", requiredDate: "", deliveryLocation: "", lowPrice: "", desiredPrice: "", maxPrice: "", preferredCountry: "", riskTolerance: "", minReliability: "", supplierTypePreference: "", moisture: "", protein: "", origin: "", grade: "", packaging: "", qcRequirement: "" });
  const [quoteError, setQuoteError] = useState("");
  const [quoteForm, setQuoteForm] = useState({ supplier: "", ingredient: "", price: "", currency: "USD", unit: "per MT", tier: "", availability: "", country: "", countryRisk: "", reliability: "", moq: "", availableQuantity: "", leadTimeDays: "", quoteValidityDate: "", paymentTerms: "", deliveryTerms: "", qualitySpec: "", documentsAvailable: "", moisture: "", protein: "", origin: "", grade: "", packaging: "", qcNote: "" });
  const [replyText, setReplyText] = useState("");
  const [approval, setApproval] = useState<Approval>();
  const [approvalReason, setApprovalReason] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [audit, setAudit] = useState<string[]>([]);
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [docs, setDocs] = useState<Record<string, boolean>>({});
  const [orderStatus, setOrderStatus] = useState(ORDER_STATUSES[0]);
  const [hydrated, setHydrated] = useState(false);

  const requestFit = useMemo<RequestFit>(() => ({
    product: request.product,
    quantity: Number(request.quantity) || undefined,
    requiredDate: request.requiredDate,
    deliveryLocation: request.deliveryLocation,
    lowPrice: Number(request.lowPrice || PRODUCT_PRICE_GUIDES[request.product]?.low) || undefined,
    averagePrice: Number(request.desiredPrice || PRODUCT_PRICE_GUIDES[request.product]?.desired) || undefined,
    maxPrice: Number(request.maxPrice || PRODUCT_PRICE_GUIDES[request.product]?.max) || undefined,
    preferredCountry: request.preferredCountry,
    riskTolerance: request.riskTolerance,
    minReliability: Number(request.minReliability) || undefined,
    supplierTypePreference: request.supplierTypePreference,
    moisture: request.moisture,
    protein: request.protein,
    origin: request.origin,
    grade: request.grade,
    packaging: request.packaging,
    qcRequirement: request.qcRequirement,
    fxRate: scenario.fxRate,
    supplierPerformance: Object.fromEntries(suppliers.map((supplier) => [supplierKey(supplier.name), {
      lateDeliveries: supplier.lateDeliveries,
      rejectedShipments: supplier.rejectedShipments,
      priceAccuracy: supplier.priceAccuracy,
      documentAccuracy: supplier.documentAccuracy,
      watchStatus: supplier.watchStatus,
    }])),
  }), [request, scenario.fxRate, suppliers]);
  const results = useMemo(() => scoreSuppliers(rows, requestFit), [requestFit, rows]);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active");
  const knownSuppliers = new Set(activeSuppliers.map((supplier) => supplierKey(supplier.name)));
  const ranked = results.filter((result) => result.score !== undefined && !result.flags.some((flag) => flag.startsWith("Blocked because supplier is blacklisted"))).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const requestProductChoice = PRODUCTS.includes(request.product) ? request.product : request.product ? "Other" : "";
  const supplierProductChoice = PRODUCTS.includes(supplierForm.product) ? supplierForm.product : supplierForm.product ? "Other" : "";
  const requestUnitChoice = UNITS.includes(request.unit) ? request.unit : request.unit ? "Other" : "";
  const quoteUnitChoice = PRICE_UNITS.includes(quoteForm.unit) ? quoteForm.unit : quoteForm.unit ? "Other" : "";
  const priceGuide = PRODUCT_PRICE_GUIDES[request.product];
  const lowPrice = request.lowPrice || (priceGuide ? String(priceGuide.low) : "");
  const averagePrice = request.desiredPrice || (priceGuide ? String(priceGuide.desired) : "");
  const targetPrice = request.maxPrice || (priceGuide ? String(priceGuide.max) : "");
  const maxPrice = Number(request.maxPrice) || priceGuide?.max || 0;
  const recommended = ranked[0];
  const cheapest = results.filter((result) => result.normalizedMidpoint !== undefined && !result.flags.some((flag) => flag.startsWith("Blocked because supplier is blacklisted"))).sort((a, b) => (a.normalizedMidpoint ?? Infinity) - (b.normalizedMidpoint ?? Infinity))[0];
  const approvedResult = approval ? results.find((result) => resultKey(result) === approval.key) : undefined;
  const validRows = results.length;
  const readyForRecommendation = validRows > 0;
  const priceProduct = request.product || quoteForm.ingredient;
  const selectedDocs = approvedResult?.country?.toLowerCase().includes("bangladesh") ? LOCAL_DOCS : IMPORT_DOCS;
  const requestSummary = [
    request.product,
    request.quantity ? `${request.quantity} ${request.unit || ""}`.trim() : "",
    request.deliveryLocation ? `to ${request.deliveryLocation}` : "",
    request.requiredDate ? `by ${request.requiredDate}` : "",
    request.preferredCountry ? `preferred country: ${request.preferredCountry}` : "",
    request.riskTolerance ? `risk: ${request.riskTolerance}` : "",
    request.minReliability ? `minimum reliability: ${request.minReliability}%` : "",
    request.supplierTypePreference ? `supplier type: ${request.supplierTypePreference}` : "",
    lowPrice ? `low bid: ${lowPrice} USD/MT` : "",
    averagePrice ? `average: ${averagePrice} USD/MT` : "",
    targetPrice ? `max: ${targetPrice} USD/MT` : "",
  ].filter(Boolean);
  const poDraft = approvedResult ? [
    "PURCHASE ORDER",
    "",
    `Supplier: ${approvedResult.supplier}`,
    `Product: ${approvedResult.ingredient}`,
    `Quantity: ${request.quantity || "[quantity]"} ${request.unit || ""}`.trim(),
    `Unit price: ${approvedResult.priceOriginal || "[price]"}`,
    `Delivery location: ${request.deliveryLocation || "[delivery location]"}`,
    `Required date: ${request.requiredDate || "[required date]"}`,
    `Approval reason: ${approval?.reason || "[reason]"}`,
    "Status: Draft - human review required",
  ].join("\n") : "Approve a supplier to generate PO draft.";
  const rfqDraft = [
    "Dear Supplier,",
    "",
    "Please send price for the following purchase request:",
    `Product: ${request.product || "[product]"}`,
    `Quantity: ${request.quantity || "[quantity]"} ${request.unit || ""}`.trim(),
    `Required date: ${request.requiredDate || "[required date]"}`,
    `Delivery location: ${request.deliveryLocation || "[delivery location]"}`,
    `Low bid price: ${lowPrice ? `${lowPrice} USD per MT` : "[optional]"}`,
    `Average buy price: ${averagePrice ? `${averagePrice} USD per MT` : "[optional]"}`,
    `Target max price: ${targetPrice ? `${targetPrice} USD per MT` : "[optional]"}`,
    `Preferred country: ${request.preferredCountry || "[optional]"}`,
    `Risk tolerance: ${request.riskTolerance || "[optional]"}`,
    `Minimum reliability: ${request.minReliability || "[optional]"}`,
    `Supplier type preference: ${request.supplierTypePreference || "[optional]"}`,
    `Moisture: ${request.moisture || "[optional]"}`,
    `Protein: ${request.protein || "[optional]"}`,
    `Origin: ${request.origin || "[optional]"}`,
    `Grade: ${request.grade || "[optional]"}`,
    `Packaging: ${request.packaging || "[optional]"}`,
    `QC requirement: ${request.qcRequirement || "[optional]"}`,
    "",
    "Please include unit price, currency, MOQ, lead time, payment terms, delivery terms, quotation validity, and available documents.",
    "",
    "Regards,",
    "Procurement Team",
  ].join("\n");

  useEffect(() => {
    loadState<AppState>().then((saved) => {
      if (!saved) return;
      setRows(saved.rows ?? []);
      setSuppliers(saved.suppliers ?? SEED_SUPPLIERS);
      setRequest((current) => ({ ...current, ...(saved.request ?? {}) }));
      setScenario((current) => saved.scenario ?? current);
      setApproval(saved.approval);
      setAudit(saved.audit ?? []);
      setAgentLog(saved.agentLog ?? []);
      setDocs(saved.docs ?? {});
      setOrderStatus(saved.orderStatus ?? ORDER_STATUSES[0]);
      setFileName(saved.rows?.length ? "Saved local data" : "No file loaded");
    }).finally(() => setHydrated(true));
    // ponytail: one app-state blob in IndexedDB; split stores if multi-user/server sync matters.
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void saveState<AppState>({ rows, suppliers, request, scenario, approval, audit, agentLog, docs, orderStatus });
  }, [agentLog, approval, audit, docs, hydrated, orderStatus, request, rows, scenario, suppliers]);

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
    setFileName("Sample supplier prices");
    setError("");
  }

  function exportAudit() {
    const headers = ["engine_version", "source", "row", "supplier", "ingredient", "price_original", "midpoint", "currency", "unit", "available_quantity", "lead_time_days", "score", "rank", "confidence", "fit_notes", "flags"];
    const csv = [headers, ...results.map((result) => ["1", result.source, result.row, result.supplier, result.ingredient, result.priceOriginal, result.midpoint, result.currency, result.unit, result.availableQuantity, result.leadTimeDays, result.score, result.rank, result.confidence, result.decisionTags?.join("; "), result.flags.join("; ")])]
      .map((record) => record.map(escapeCsv).join(","))
      .join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "procurement-analysis-audit.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function saveSupplier() {
    const next = addSupplier(suppliers, {
      ...supplierForm,
      lateDeliveries: supplierForm.lateDeliveries ? Number(supplierForm.lateDeliveries) : undefined,
      rejectedShipments: supplierForm.rejectedShipments ? Number(supplierForm.rejectedShipments) : undefined,
      priceAccuracy: supplierForm.priceAccuracy ? Number(supplierForm.priceAccuracy) : undefined,
      documentAccuracy: supplierForm.documentAccuracy ? Number(supplierForm.documentAccuracy) : undefined,
      watchStatus: supplierForm.watchStatus as SupplierProfile["watchStatus"],
    });
    setSuppliers(next.suppliers);
    setSupplierError(next.error);
    if (!next.error) setSupplierForm({ name: "", product: "", country: "", email: "", phone: "", lateDeliveries: "", rejectedShipments: "", priceAccuracy: "", documentAccuracy: "", watchStatus: "clear" });
  }

  function addManualQuote() {
    if (!quoteForm.supplier.trim() || !priceProduct.trim()) {
      setQuoteError("Supplier and product are required.");
      return;
    }
    setRows((current) => [...current, {
      source: "Manual",
      row: current.filter((row) => row.source === "Manual").length + 1,
      supplier: quoteForm.supplier.trim(),
      ingredient: priceProduct.trim(),
      priceOriginal: quoteForm.price.trim() || undefined,
      currency: quoteForm.currency.trim().toUpperCase() || undefined,
      unit: quoteForm.unit.trim() || undefined,
      tier: quoteForm.tier.trim() || undefined,
      availability: quoteForm.availability.trim() || undefined,
      country: quoteForm.country.trim() || undefined,
      countryRisk: quoteForm.countryRisk.trim() || undefined,
      reliability: quoteForm.reliability.trim() ? Number(quoteForm.reliability) : undefined,
      moq: quoteForm.moq.trim() ? Number(quoteForm.moq) : undefined,
      availableQuantity: quoteForm.availableQuantity.trim() ? Number(quoteForm.availableQuantity) : undefined,
      leadTimeDays: quoteForm.leadTimeDays.trim() ? Number(quoteForm.leadTimeDays) : undefined,
      quoteValidityDate: quoteForm.quoteValidityDate || undefined,
      paymentTerms: quoteForm.paymentTerms.trim() || undefined,
      deliveryTerms: quoteForm.deliveryTerms.trim() || undefined,
      qualitySpec: quoteForm.qualitySpec.trim() || undefined,
      documentsAvailable: quoteForm.documentsAvailable.trim() || undefined,
      moisture: quoteForm.moisture.trim() || undefined,
      protein: quoteForm.protein.trim() || undefined,
      origin: quoteForm.origin.trim() || undefined,
      grade: quoteForm.grade.trim() || undefined,
      packaging: quoteForm.packaging.trim() || undefined,
      qcNote: quoteForm.qcNote.trim() || undefined,
    }]);
    setImportMeta((current) => ({ rows: [], rejected: current?.rejected ?? [], sheets: [...new Set([...(current?.sheets ?? []), "Manual"])] }));
    setFileName("Manual supplier price");
    setQuoteError("");
    setQuoteForm({ supplier: "", ingredient: request.product, price: "", currency: "USD", unit: "per MT", tier: "", availability: "", country: "", countryRisk: "", reliability: "", moq: "", availableQuantity: "", leadTimeDays: "", quoteValidityDate: "", paymentTerms: "", deliveryTerms: "", qualitySpec: "", documentsAvailable: "", moisture: "", protein: "", origin: "", grade: "", packaging: "", qcNote: "" });
  }

  function logAgent(message: string) {
    setAgentLog((current) => [`${new Date().toLocaleString()}: ${message}`, ...current]);
  }

  function prototypeRows(source: string): SupplierInput[] {
    const product = request.product || "Maize";
    const base = Number(request.desiredPrice || PRODUCT_PRICE_GUIDES[product]?.desired || 250);
    return [
      { source, row: 1, supplier: "Bengal Feed Leads", ingredient: product, priceOriginal: `$${base - 4}`, currency: "USD", unit: "per MT", tier: "Local", availability: "In stock", country: request.preferredCountry || "Bangladesh", countryRisk: request.riskTolerance || "Medium", reliability: Number(request.minReliability) || 78, moq: 5, availableQuantity: Number(request.quantity) || 80, leadTimeDays: 3, quoteValidityDate: "2026-07-20", paymentTerms: "Cash", deliveryTerms: "Warehouse delivery", documentsAvailable: "Invoice, QC report", moisture: request.moisture || "14%", protein: request.protein || "8%", origin: request.origin || "Bangladesh", grade: request.grade || "Feed grade", packaging: request.packaging || "50kg bag", qcNote: request.qcRequirement || "QC passed" },
      { source, row: 2, supplier: "Portside Agro Desk", ingredient: product, priceOriginal: `$${base + 8}`, currency: "USD", unit: "per MT", tier: "Trading Company", availability: "On order", country: "India", countryRisk: "Medium", reliability: 82, moq: 20, availableQuantity: 200, leadTimeDays: 14, quoteValidityDate: "2026-07-25", paymentTerms: "TT", deliveryTerms: "CPT Dhaka", documentsAvailable: "CO, invoice", moisture: "13%", protein: "9%", origin: "India", grade: "Feed grade", packaging: "Bulk", qcNote: "QC pending" },
    ];
  }

  function addPrototypeRows(source: string, message: string) {
    if (rows.some((row) => row.source === source)) return logAgent(`${source} already added.`);
    setRows((current) => [...current, ...prototypeRows(source)]);
    setImportMeta((current) => ({ rows: [], rejected: current?.rejected ?? [], sheets: [...new Set([...(current?.sheets ?? []), source])] }));
    setFileName(source);
    logAgent(message);
  }

  function openEmailDrafts() {
    const emails = activeSuppliers.map((supplier) => supplier.email).filter(Boolean).join(",");
    if (!emails) return logAgent("No supplier emails found. Add supplier emails first.");
    const link = document.createElement("a");
    link.href = `mailto:?bcc=${encodeURIComponent(emails)}&subject=${encodeURIComponent(`RFQ: ${request.product || "feed product"}`)}&body=${encodeURIComponent(rfqDraft)}`;
    link.click();
    setOrderStatus("RFQ sent");
    logAgent("Opened real email compose with active supplier emails. You still click Send.");
  }

  function importEmailReply() {
    const supplier = replyText.match(/supplier:\s*(.+)/i)?.[1]?.split(/\r?\n/)[0]?.trim()
      || replyText.match(/from:\s*([^<\r\n]+)/i)?.[1]?.trim()
      || "Email supplier";
    const price = replyText.match(/(?:price|rate|offer)[:\s$]*(usd|bdt|inr|cny|eur)?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
    const value = price?.[2]?.replaceAll(",", "");
    if (!value || parsePrice(value) === undefined) return logAgent("Could not find a valid price in pasted reply.");
    const currency = price?.[1]?.toUpperCase() || (replyText.includes("à§³") ? "BDT" : "USD");
    setRows((current) => [...current, { source: "Email reply import", row: current.filter((row) => row.source === "Email reply import").length + 1, supplier, ingredient: priceProduct || request.product || "Unknown product", priceOriginal: value, currency, unit: "per MT", availability: "In stock", country: request.preferredCountry || undefined, countryRisk: request.riskTolerance || undefined, reliability: Number(request.minReliability) || undefined, availableQuantity: Number(request.quantity) || undefined, leadTimeDays: 7, moisture: request.moisture || undefined, protein: request.protein || undefined, origin: request.origin || undefined, grade: request.grade || undefined, packaging: request.packaging || undefined, qcNote: request.qcRequirement || undefined }]);
    setFileName("Email reply import");
    setOrderStatus("Prices received");
    setReplyText("");
    logAgent(`Imported real pasted email reply from ${supplier}.`);
  }

  function runOnlineSearch() {
    addPrototypeRows("Online search prototype", "Found mock suppliers from online directories.");
  }

  function collectSupplierReplies() {
    addPrototypeRows("Email reply prototype", "Collected mock supplier email replies and added prices.");
    setOrderStatus("Prices received");
  }

  function draftSupplierEmails() {
    openEmailDrafts();
  }

  function scheduleFollowUp() {
    const responders = new Set(rows.map((row) => supplierKey(row.supplier)));
    const pending = activeSuppliers.filter((supplier) => !responders.has(supplierKey(supplier.name))).map((supplier) => supplier.name);
    logAgent(pending.length ? `Follow up with: ${pending.join(", ")}.` : "No follow-up needed. All active suppliers have prices.");
  }

  function verifySuppliers() {
    logAgent("Checked mock registry signals: business name, country, contact, and risk notes.");
  }

  function monitorShipment() {
    const next = ORDER_STATUSES[Math.min(ORDER_STATUSES.length - 1, ORDER_STATUSES.indexOf(orderStatus) + 1)];
    setOrderStatus(next);
    logAgent(`Shipment monitor moved status to ${next}.`);
  }

  function suggestDecision() {
    logAgent(recommended ? `Decision suggestion: ${recommended.supplier} is best ranked. Human approval still required.` : "Decision suggestion unavailable: add supplier prices first.");
  }

  function resultKey(result: ScoreResult) {
    return `${result.source}-${result.row}-${result.supplier}-${result.ingredient}`;
  }

  function approve(result: ScoreResult) {
    if (!approvalReason.trim()) {
      setApprovalError("Approval reason is required.");
      return;
    }
    const override = recommended && resultKey(result) !== resultKey(recommended) ? " Manager override." : "";
    const next = { key: resultKey(result), supplier: result.supplier, ingredient: result.ingredient, approvedAt: new Date().toISOString(), reason: approvalReason.trim() };
    setApproval(next);
    setOrderStatus("Approved");
    setApprovalError("");
    setAudit((current) => [`Approved ${result.supplier} for ${result.ingredient}. Reason: ${approvalReason.trim()}.${override}`, ...current]);
  }

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <p className="label">Procurement workspace</p>
          <h1>JOGAN</h1>
          <p>Feed supplier pricing, recommendation, approval, PO, and tracking in one local workbench.</p>
        </div>
        <strong className="save-state">Local workspace</strong>
      </header>

      <nav className="steps" aria-label="Procurement steps">
        {STEPS.map((item, index) => (
          <button className={index === step ? "active" : index < step ? "done" : ""} key={item} type="button" onClick={() => setStep(index)}>
            {index + 1}. {item}
          </button>
        ))}
      </nav>

      <div className="workspace">
      <section className="card step-card">
        <p className="label">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>

        {step === 0 && (
          <>
            <h2>What do you need?</h2>
            <p className="muted">Set the buying requirement once. Product and quantity are required; the rest helps judge supplier fit.</p>
            <div className="fields">
              <label>Product / ingredient<select aria-label="Product / ingredient" value={requestProductChoice} onChange={(event) => {
                const product = event.target.value === "Other" ? "" : event.target.value;
                const guide = PRODUCT_PRICE_GUIDES[product];
                setRequest({ ...request, product, lowPrice: guide ? String(guide.low) : "", desiredPrice: guide ? String(guide.desired) : "", maxPrice: guide ? String(guide.max) : "" });
                if (!quoteForm.ingredient || quoteForm.ingredient === request.product) setQuoteForm({ ...quoteForm, ingredient: product });
              }}><option value="">Select product</option>{PRODUCTS.map((product) => <option key={product}>{product}</option>)}<option>Other</option></select></label>
              {requestProductChoice === "Other" && <label>Other product<input value={request.product} onChange={(event) => setRequest({ ...request, product: event.target.value })} /></label>}
              <fieldset className="quantity-unit">
                <legend>Quantity</legend>
                <div className="split-control">
                  <input aria-label="Quantity" type="number" min="0" value={request.quantity} onChange={(event) => setRequest({ ...request, quantity: event.target.value })} />
                  <select aria-label="Unit" value={requestUnitChoice} onChange={(event) => setRequest({ ...request, unit: event.target.value === "Other" ? "" : event.target.value })}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}<option>Other</option></select>
                </div>
              </fieldset>
              {requestUnitChoice === "Other" && <label>Other unit<input value={request.unit} onChange={(event) => setRequest({ ...request, unit: event.target.value })} /></label>}
              <label>Required date<input type="date" value={request.requiredDate} onChange={(event) => setRequest({ ...request, requiredDate: event.target.value })} /></label>
              <label>Delivery location<input value={request.deliveryLocation} onChange={(event) => setRequest({ ...request, deliveryLocation: event.target.value })} /></label>
              <div className="price-guide">
                <div className="market-card"><span>Low bid price</span><strong>{lowPrice || "-"} USD</strong><small>Strong price for suppliers who want to win the contract.</small></div>
                <div className="market-card"><span>Average buy price</span><strong>{averagePrice || "-"} USD</strong><small>{priceGuide ? `Typical average for ${request.product}` : "Choose a product to calculate"}</small></div>
                <div className="market-card"><span>Max price you allow</span><strong>{targetPrice || "-"} USD</strong><small>Supplier prices above this are expensive for this request.</small></div>
                <label className="slider-row">Max price slider<input aria-label="Max price slider" type="range" min={priceGuide?.min ?? 0} max={priceGuide?.ceiling ?? 5000} step="1" value={maxPrice} disabled={!priceGuide} onChange={(event) => setRequest({ ...request, maxPrice: event.target.value })} /></label>
              </div>
              <label>Preferred country<select aria-label="Preferred country" value={request.preferredCountry} onChange={(event) => setRequest({ ...request, preferredCountry: event.target.value })}><option value="">Any country</option>{COUNTRIES.map((country) => <option key={country}>{country}</option>)}</select></label>
              <label>Country risk tolerance<select aria-label="Country risk tolerance" value={request.riskTolerance} onChange={(event) => setRequest({ ...request, riskTolerance: event.target.value })}><option value="">Any risk level</option>{RISK_LEVELS.map((risk) => <option key={risk}>{risk}</option>)}</select></label>
              <label>Minimum reliability<input aria-label="Minimum reliability" type="number" min="0" max="100" value={request.minReliability} onChange={(event) => setRequest({ ...request, minReliability: event.target.value })} placeholder="0-100" /></label>
              <label>Supplier type preference<select aria-label="Supplier type preference" value={request.supplierTypePreference} onChange={(event) => setRequest({ ...request, supplierTypePreference: event.target.value })}><option value="">Any supplier type</option>{SUPPLIER_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <details className="advanced full-row">
                <summary>Optional: product specification</summary>
                <p className="muted">Use this when quality matters. The system warns if supplier specs do not match.</p>
                <div className="fields">
                  <label>Moisture<input aria-label="Moisture" value={request.moisture} onChange={(event) => setRequest({ ...request, moisture: event.target.value })} placeholder="Example: 14%" /></label>
                  <label>Protein<input aria-label="Protein" value={request.protein} onChange={(event) => setRequest({ ...request, protein: event.target.value })} placeholder="Example: 46%" /></label>
                  <label>Origin<input aria-label="Origin" value={request.origin} onChange={(event) => setRequest({ ...request, origin: event.target.value })} /></label>
                  <label>Grade<input aria-label="Grade" value={request.grade} onChange={(event) => setRequest({ ...request, grade: event.target.value })} /></label>
                  <label>Packaging<input aria-label="Packaging" value={request.packaging} onChange={(event) => setRequest({ ...request, packaging: event.target.value })} /></label>
                  <label>QC requirement<input aria-label="QC requirement" value={request.qcRequirement} onChange={(event) => setRequest({ ...request, qcRequirement: event.target.value })} /></label>
                </div>
              </details>
            </div>
            <p className="muted">Request: {request.product || "No product"} · {request.quantity || "No quantity"} {request.unit || ""} · {request.requiredDate || "No date"} · {request.deliveryLocation || "No delivery location"}</p>
            <p className="muted">Preference: low {lowPrice || "not set"} USD · average {averagePrice || "not set"} USD · max {targetPrice || "not set"} USD · country {request.preferredCountry || "any"} · risk {request.riskTolerance || "any"} · reliability {request.minReliability || "any"} · type {request.supplierTypePreference || "any"}</p>
            <p><strong>What happens next:</strong> collect supplier prices so the system can recommend the best option.</p>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Get Supplier Prices</h2>
            {requestSummary.length > 0 && <div className="request-summary"><strong>Request summary</strong><p>{requestSummary.join(" · ")}</p></div>}
            <p className="muted">Upload supplier prices, use sample data, or search online later. For recommendation, click Next after adding prices.</p>
            <div className="actions price-actions">
              <button className="button-primary primary-action" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "Reading file..." : "Upload Excel/CSV"}</button>
              <button className="button-secondary" type="button" onClick={runOnlineSearch}>Online Search</button>
              <button className="button-secondary" type="button" onClick={loadSample}>Use sample data</button>
              <button className="button-ghost" type="button" onClick={exportAudit} disabled={!results.length}>Export audit CSV</button>
            </div>
            <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.csv" onChange={(event) => loadFile(event.target.files?.[0])} />
            <p className="muted">Current data: {fileName}</p>
            <p className="muted">Spreadsheet required columns: supplier, product. Useful: price, currency, unit, MOQ, available quantity, lead time days, validity date, terms, documents, country risk, reliability.</p>
            {error && <p className="error" role="alert">{error}</p>}

            <details className="advanced">
              <summary>Optional: manually add supplier price</summary>
              <p className="muted">Use this only when a supplier gives you a price by phone, SMS, or WhatsApp.</p>
              <div className="fields">
                <label>Supplier name<input aria-label="Supplier" value={quoteForm.supplier} onChange={(event) => setQuoteForm({ ...quoteForm, supplier: event.target.value })} /></label>
                <fieldset className="price-unit">
                  <legend>Price</legend>
                  <div className="triple-control">
                    <input aria-label="Price amount" value={quoteForm.price} onChange={(event) => setQuoteForm({ ...quoteForm, price: event.target.value })} />
                    <select aria-label="Currency" value={quoteForm.currency} onChange={(event) => setQuoteForm({ ...quoteForm, currency: event.target.value })}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
                    <select aria-label="Price unit" value={quoteUnitChoice} onChange={(event) => setQuoteForm({ ...quoteForm, unit: event.target.value === "Other" ? "" : event.target.value })}>{PRICE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}<option>Other</option></select>
                  </div>
                </fieldset>
                {quoteUnitChoice === "Other" && <label>Other price unit<input value={quoteForm.unit} onChange={(event) => setQuoteForm({ ...quoteForm, unit: event.target.value })} /></label>}
              </div>
              <details className="advanced">
                <summary>Optional: quote fit details</summary>
                <p className="muted">These improve recommendation quality: quantity, delivery speed, validity, payment, delivery terms, and documents.</p>
                <div className="fields">
                  <label>MOQ<input type="number" min="0" value={quoteForm.moq} onChange={(event) => setQuoteForm({ ...quoteForm, moq: event.target.value })} /></label>
                  <label>Available quantity<input type="number" min="0" value={quoteForm.availableQuantity} onChange={(event) => setQuoteForm({ ...quoteForm, availableQuantity: event.target.value })} /></label>
                  <label>Lead time days<input type="number" min="0" value={quoteForm.leadTimeDays} onChange={(event) => setQuoteForm({ ...quoteForm, leadTimeDays: event.target.value })} /></label>
                  <label>Quote valid until<input type="date" value={quoteForm.quoteValidityDate} onChange={(event) => setQuoteForm({ ...quoteForm, quoteValidityDate: event.target.value })} /></label>
                  <label>Payment terms<input value={quoteForm.paymentTerms} onChange={(event) => setQuoteForm({ ...quoteForm, paymentTerms: event.target.value })} /></label>
                  <label>Delivery terms / incoterm<input value={quoteForm.deliveryTerms} onChange={(event) => setQuoteForm({ ...quoteForm, deliveryTerms: event.target.value })} /></label>
                  <label>Quality/spec note<input value={quoteForm.qualitySpec} onChange={(event) => setQuoteForm({ ...quoteForm, qualitySpec: event.target.value })} /></label>
                  <label>Documents available<input value={quoteForm.documentsAvailable} onChange={(event) => setQuoteForm({ ...quoteForm, documentsAvailable: event.target.value })} /></label>
                  <label>Moisture<input value={quoteForm.moisture} onChange={(event) => setQuoteForm({ ...quoteForm, moisture: event.target.value })} /></label>
                  <label>Protein<input value={quoteForm.protein} onChange={(event) => setQuoteForm({ ...quoteForm, protein: event.target.value })} /></label>
                  <label>Origin<input value={quoteForm.origin} onChange={(event) => setQuoteForm({ ...quoteForm, origin: event.target.value })} /></label>
                  <label>Grade<input value={quoteForm.grade} onChange={(event) => setQuoteForm({ ...quoteForm, grade: event.target.value })} /></label>
                  <label>Packaging<input value={quoteForm.packaging} onChange={(event) => setQuoteForm({ ...quoteForm, packaging: event.target.value })} /></label>
                  <label>QC note<input value={quoteForm.qcNote} onChange={(event) => setQuoteForm({ ...quoteForm, qcNote: event.target.value })} /></label>
                </div>
              </details>
              <div className="actions row-gap"><button className="button-primary" type="button" onClick={addManualQuote}>Save supplier price</button></div>
            </details>
            {quoteError && <p className="error" role="alert">{quoteError}</p>}
            <div className="recommendation" aria-label="Price step recommendation">
              {recommended ? <><strong>Current recommendation: {recommended.supplier}</strong><p>Score {recommended.score?.toFixed(1)} for {recommended.ingredient}. Confidence {recommended.confidenceLabel ?? "Weak"} ({recommended.confidence?.toFixed(0) ?? "N/A"}%). {(recommended.decisionTags ?? []).join(", ")}</p><p className="muted">Original: {recommended.priceOriginal || "missing"} {recommended.currency || ""} {recommended.unit || ""}. Normalized: {recommended.normalizedMidpoint ? `${recommended.normalizedMidpoint.toFixed(2)} USD per MT` : "not available"}.</p>{recommended.splitSuggestion && <p className="muted">Split order: {recommended.splitSuggestion}</p>}</> : <p>Add at least one supplier price to see a recommendation.</p>}
            </div>

            <details className="advanced">
              <summary>Optional: supplier database</summary>
              <p className="muted">Store suppliers you already know. The app uses this to mark whether a price came from an existing supplier.</p>
              <div className="table-head"><h3>Supplier database</h3><p>{activeSuppliers.length} active supplier(s)</p></div>
              <div className="fields">
                <label>Name<input value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} /></label>
                <label>Product<select aria-label="Product" value={supplierProductChoice} onChange={(event) => setSupplierForm({ ...supplierForm, product: event.target.value === "Other" ? "" : event.target.value })}><option value="">Select product</option>{PRODUCTS.map((product) => <option key={product}>{product}</option>)}<option>Other</option></select></label>
                {supplierProductChoice === "Other" && <label>Other product<input value={supplierForm.product} onChange={(event) => setSupplierForm({ ...supplierForm, product: event.target.value })} /></label>}
                <label>Country<input value={supplierForm.country} onChange={(event) => setSupplierForm({ ...supplierForm, country: event.target.value })} /></label>
                <label>Email<input type="email" value={supplierForm.email} onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })} /></label>
                <label>Phone<input value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></label>
                <label>Late delivery count<input type="number" min="0" value={supplierForm.lateDeliveries} onChange={(event) => setSupplierForm({ ...supplierForm, lateDeliveries: event.target.value })} /></label>
                <label>Rejected shipment count<input type="number" min="0" value={supplierForm.rejectedShipments} onChange={(event) => setSupplierForm({ ...supplierForm, rejectedShipments: event.target.value })} /></label>
                <label>Price accuracy %<input type="number" min="0" max="100" value={supplierForm.priceAccuracy} onChange={(event) => setSupplierForm({ ...supplierForm, priceAccuracy: event.target.value })} /></label>
                <label>Document accuracy %<input type="number" min="0" max="100" value={supplierForm.documentAccuracy} onChange={(event) => setSupplierForm({ ...supplierForm, documentAccuracy: event.target.value })} /></label>
                <label>Status<select value={supplierForm.watchStatus} onChange={(event) => setSupplierForm({ ...supplierForm, watchStatus: event.target.value })}><option value="clear">Clear</option><option value="watchlist">Watchlist</option><option value="blacklist">Blacklist</option></select></label>
              </div>
              <div className="actions row-gap"><button className="button-primary" type="button" onClick={saveSupplier}>Add supplier</button></div>
              {supplierError && <p className="error" role="alert">{supplierError}</p>}
              <div className="table-wrap compact">
                <table>
                  <thead><tr><th>Name</th><th>Product</th><th>Country</th><th>History</th><th>Action</th></tr></thead>
                  <tbody>{activeSuppliers.map((supplier) => <tr key={supplier.id}><td>{supplier.name}<small>{supplier.watchStatus || "clear"}</small></td><td>{supplier.product || "-"}</td><td>{supplier.country || "-"}</td><td>Late {supplier.lateDeliveries ?? 0}, reject {supplier.rejectedShipments ?? 0}<small>Price {supplier.priceAccuracy ?? "-"}%, docs {supplier.documentAccuracy ?? "-"}%</small></td><td><button className="button-ghost button-small" type="button" onClick={() => setSuppliers(archiveSupplier(suppliers, supplier.id))}>Archive</button></td></tr>)}</tbody>
                </table>
              </div>
            </details>

            <details className="advanced">
              <summary>Optional: RFQ draft</summary>
              <p className="muted">Copy this message and send manually. Email/SMS automation comes later.</p>
              <textarea className="rfq" readOnly value={rfqDraft} aria-label="RFQ draft" />
            </details>

            <details className="advanced">
              <summary>Optional: free agent prototypes</summary>
              <p className="muted">Email compose and pasted reply import are real/free. Search and verification are still local prototypes.</p>
              <div className="actions row-gap">
                <button className="button-secondary" type="button" onClick={draftSupplierEmails}>Open real email draft</button>
                <button className="button-secondary" type="button" onClick={collectSupplierReplies}>Collect mock replies</button>
                <button className="button-secondary" type="button" onClick={scheduleFollowUp}>Queue follow-up</button>
                <button className="button-secondary" type="button" onClick={verifySuppliers}>Verify mock suppliers</button>
                <button className="button-secondary" type="button" onClick={suggestDecision}>Suggest decision</button>
              </div>
              <label className="reply-box">Paste real supplier email reply<textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Example:&#10;From: Delta Agro&#10;Supplier: Delta Agro&#10;Price: USD 244 per MT" /></label>
              <button className="button-primary" type="button" onClick={importEmailReply}>Import pasted reply</button>
              <ul>{agentLog.length ? agentLog.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>No prototype actions yet.</li>}</ul>
            </details>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Review Recommendation</h2>
            <p className="muted">The recommendation is calculated from price, request fit, quantity, lead time, risk, reliability, country, supplier type, and quote quality.</p>
            <div className="recommendation recommendation-card" aria-label="Supplier recommendation">
              {recommended ? <><span className="status-badge">Best overall</span><strong>Recommended supplier: {recommended.supplier}</strong><div className="metric-grid"><span>Score <b>{recommended.score?.toFixed(1)}</b></span><span>Confidence <b>{recommended.confidenceLabel ?? "Weak"} {recommended.confidence?.toFixed(0) ?? "N/A"}%</b></span><span>Price <b>{recommended.normalizedMidpoint ? `${recommended.normalizedMidpoint.toFixed(2)} USD/MT` : "Not normalized"}</b></span></div><p>For {recommended.ingredient}. {cheapest && cheapest.supplier !== recommended.supplier ? `Lowest price is ${cheapest.supplier}, but request fit favors ${recommended.supplier}.` : "It is also the lowest comparable price."}</p><p className="muted">Why: {(recommended.decisionTags ?? ["Best overall"]).join(", ")}.</p>{recommended.splitSuggestion && <p className="warning-chip">Split order: {recommended.splitSuggestion}</p>}<p className="muted">{recommended.flags.length ? `Warnings: ${recommended.flags.join("; ")}` : "No major warnings on this row."}</p></> : <p>No recommendation yet. Go back and add supplier prices.</p>}
            </div>
            <details className="advanced">
              <summary>Optional: import cost settings</summary>
              <p className="muted">Use this to estimate landed cost after freight, duty, VAT, FX, and transport. It does not change the original supplier price.</p>
              <div className="fields">
                <label>Freight / unit<input type="number" min="0" value={scenario.freight} onChange={(event) => setScenario({ ...scenario, freight: Number(event.target.value) })} /></label>
                <label>Insurance %<input type="number" min="0" step="0.1" value={scenario.insurance} onChange={(event) => setScenario({ ...scenario, insurance: Number(event.target.value) })} /></label>
                <label>Duty %<input type="number" min="0" step="0.1" value={scenario.duty} onChange={(event) => setScenario({ ...scenario, duty: Number(event.target.value) })} /></label>
                <label>VAT %<input type="number" min="0" step="0.1" value={scenario.vat} onChange={(event) => setScenario({ ...scenario, vat: Number(event.target.value) })} /></label>
                <label>FX rate<input type="number" min="0" step="0.01" value={scenario.fxRate} onChange={(event) => setScenario({ ...scenario, fxRate: Number(event.target.value) })} /></label>
                <label>Other charges<input type="number" min="0" value={scenario.charges} onChange={(event) => setScenario({ ...scenario, charges: Number(event.target.value) })} /></label>
                <label>Inland transport<input type="number" min="0" value={scenario.inlandTransport} onChange={(event) => setScenario({ ...scenario, inlandTransport: Number(event.target.value) })} /></label>
              </div>
            </details>
            <div className="table-head"><h3>Supplier price comparison</h3><p>{results.length} valid row(s), {importMeta?.rejected.length ?? 0} rejected</p></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Rank</th><th>Supplier</th><th>Ingredient</th><th>Price</th><th>Score</th><th>Confidence</th><th>Fit notes</th><th>Estimated landed cost</th><th>Warnings</th></tr></thead>
                <tbody>{results.length ? results.map((result) => <tr key={`${result.source}-${result.row}`}><td>{result.rank ? `#${result.rank}` : "-"}</td><td>{result.supplier}<small>{knownSuppliers.has(supplierKey(result.supplier)) ? "Existing supplier" : "Not in supplier database"} · {result.country || "No country"}</small></td><td>{result.ingredient}<small>{result.tier || "No supplier type"}</small></td><td>{result.priceOriginal || "Missing"}<small>{result.currency && result.unit ? `${result.currency} / ${result.unit}` : "Missing unit/currency"}</small><small>{result.normalizedMidpoint ? `Normalized: ${result.normalizedMidpoint.toFixed(2)} USD / per MT` : "Not normalized"}</small></td><td>{result.score?.toFixed(1) ?? "N/A"}</td><td>{result.confidenceLabel ?? "Weak"}<small>{result.confidence?.toFixed(0) ?? result.completeness.toFixed(0)}%</small></td><td>{result.decisionTags?.join(", ") || "-"}{result.splitSuggestion && <small>Split order: {result.splitSuggestion}</small>}</td><td>{result.midpoint === undefined ? "N/A" : `${landedCostByTerm(result.normalizedMidpoint ?? result.midpoint, result.deliveryTerms, scenario.freight, scenario.insurance, scenario.duty, scenario.charges, scenario.fxRate, scenario.vat, scenario.inlandTransport).toFixed(2)} BDT`}</td><td>{result.flags.join("; ") || "OK"}</td></tr>) : <tr><td colSpan={9}>Go back and add supplier prices.</td></tr>}</tbody>
              </table>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Approve Supplier</h2>
            <p className="muted">Human approval is required before PO. Choose the recommended supplier or select another supplier price.</p>
            <label>Approval reason<textarea value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="Example: best landed cost, acceptable lead time, docs available" /></label>
            {approvalError && <p className="error" role="alert">{approvalError}</p>}
            {recommended ? <div className="recommendation recommendation-card"><span className="status-badge">Ready for approval</span><strong>{recommended.supplier}</strong><p>Recommended for {recommended.ingredient}. Score {recommended.score?.toFixed(1)}.</p><button className="button-primary" type="button" onClick={() => approve(recommended)}>Approve recommended supplier</button></div> : <p>No supplier ready for approval.</p>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Supplier</th><th>Ingredient</th><th>Score</th><th>Action</th></tr></thead>
                <tbody>{results.length ? results.map((result) => <tr key={`${result.source}-${result.row}`}><td>{result.supplier}</td><td>{result.ingredient}</td><td>{result.score?.toFixed(1) ?? "N/A"}</td><td><button className="button-secondary button-small" type="button" onClick={() => approve(result)}>{approval?.key === resultKey(result) ? "Approved" : "Approve"}</button></td></tr>) : <tr><td colSpan={4}>No supplier prices to approve.</td></tr>}</tbody>
              </table>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Prepare PO + Track Order</h2>
            <p className="muted">Approved supplier: {approval ? `${approval.supplier} for ${approval.ingredient}` : "None"}</p>
            <div className="fields"><label>Order status<select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>{ORDER_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label></div>
            <h3>PO draft</h3>
            <textarea className="rfq" readOnly value={poDraft} aria-label="PO draft" />
            <h3>Document checklist</h3>
            <div className="checklist">{selectedDocs.map((doc) => <label key={doc}><input type="checkbox" checked={Boolean(docs[doc])} onChange={(event) => setDocs({ ...docs, [doc]: event.target.checked })} /> {doc}</label>)}</div>
            <details className="advanced"><summary>Optional: shipment monitor prototype</summary><p className="muted">This advances order status locally to show how shipment monitoring would look before a real shipping API.</p><button className="button-secondary" type="button" onClick={monitorShipment}>Advance shipment status</button></details>
            <details className="advanced"><summary>Optional: audit trail</summary><p className="muted">Shows approval history so you can see who/what was approved during the buying flow.</p><ul>{audit.length ? audit.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>No approvals yet.</li>}</ul></details>
            <details className="advanced"><summary>Optional: agent log</summary><p className="muted">Shows local prototype actions the agent simulated.</p><ul>{agentLog.length ? agentLog.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>No prototype actions yet.</li>}</ul></details>
          </>
        )}

        <div className="wizard-actions">
          <button className="button-primary" type="button" onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))} disabled={step === STEPS.length - 1}>Next</button>
        </div>

        {importMeta && importMeta.rejected.length > 0 && <details className="advanced"><summary>Rejected rows</summary><ul>{importMeta.rejected.map((item) => <li key={`${item.source}-${item.row}`}>{item.source}, row {item.row}: {item.reason}</li>)}</ul></details>}
      </section>

      <aside className="context-panel" aria-label="Procurement context">
        <p className="label">Current work</p>
        <h2>{STEPS[step]}</h2>
        <div className="context-block">
          <strong>Request</strong>
          <p>{requestSummary.length ? requestSummary.slice(0, 6).join(" Â· ") : "No request yet"}</p>
        </div>
        <div className="context-block">
          <strong>Recommendation status</strong>
          <p>{recommended ? `${recommended.supplier} - ${recommended.confidenceLabel ?? "Weak"} confidence` : readyForRecommendation ? "Calculating recommendation" : "Add supplier prices first"}</p>
        </div>
        <div className="context-block">
          <strong>Data quality</strong>
          <p>{validRows} supplier price row(s). {importMeta?.rejected.length ?? 0} rejected.</p>
        </div>
      </aside>
      </div>
    </main>
  );
}
