export type SupplierInput = {
  source: string;
  row: number;
  supplier: string;
  ingredient: string;
  priceOriginal?: string;
  currency?: string;
  unit?: string;
  tier?: string;
  availability?: string;
  country?: string;
  countryRisk?: string | number;
  reliability?: number;
  moq?: number;
  availableQuantity?: number;
  leadTimeDays?: number;
  quoteValidityDate?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  qualitySpec?: string;
  documentsAvailable?: string;
  moisture?: string;
  protein?: string;
  origin?: string;
  grade?: string;
  packaging?: string;
  qcNote?: string;
};

export type Factor = "price" | "tier" | "availability" | "countryRisk" | "reliability";
export type WatchStatus = "clear" | "watchlist" | "blacklist";
export type SupplierPerformance = {
  lateDeliveries?: number;
  rejectedShipments?: number;
  priceAccuracy?: number;
  documentAccuracy?: number;
  watchStatus?: WatchStatus;
};

export type RequestFit = {
  product?: string;
  quantity?: number;
  requiredDate?: string;
  deliveryLocation?: string;
  lowPrice?: number;
  averagePrice?: number;
  maxPrice?: number;
  preferredCountry?: string;
  riskTolerance?: string;
  minReliability?: number;
  supplierTypePreference?: string;
  moisture?: string;
  protein?: string;
  origin?: string;
  grade?: string;
  packaging?: string;
  qcRequirement?: string;
  supplierPerformance?: Record<string, SupplierPerformance>;
  fxRate?: number;
};

export type ScoreResult = SupplierInput & {
  midpoint?: number;
  normalizedMidpoint?: number;
  normalizedCurrency?: "USD";
  normalizedUnit?: "per MT";
  subscores: Partial<Record<Factor, number>>;
  contributions: Partial<Record<Factor, number>>;
  score?: number;
  confidence?: number;
  confidenceLabel?: "Strong" | "Medium" | "Weak";
  decisionTags?: string[];
  splitSuggestion?: string;
  completeness: number;
  flags: string[];
  rank?: number;
};

export const WEIGHTS: Record<Factor, number> = {
  price: 0.35,
  tier: 0.2,
  availability: 0.15,
  countryRisk: 0.15,
  reliability: 0.15,
};

const TIERS: Record<string, number> = {
  "global mnc": 5,
  "international manufacturer": 4,
  regional: 3,
  local: 2,
  "trading company": 1,
};

const AVAILABILITY: Record<string, number> = {
  "readily available": 100,
  "in stock": 90,
  seasonal: 60,
  "on order": 40,
  limited: 30,
};

const RISK: Record<string, number> = { low: 100, medium: 50, high: 0 };
const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };

const clean = (value?: string) => value?.trim().toLowerCase();
const round = (value: number) => Math.round(value * 100) / 100;
const hasText = (source: string | undefined, term: string) => clean(source)?.includes(clean(term) ?? "") ?? false;
const supplierKey = (name: string) => name.trim().toLowerCase();

export function parsePrice(value?: string): number | undefined {
  if (!value) return undefined;
  const numbers = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers?.length || numbers.length > 2 || numbers.some((number) => number < 0)) return undefined;
  return round(numbers.reduce((sum, number) => sum + number, 0) / numbers.length);
}

function fixedSubscores(input: SupplierInput) {
  const subscores: Partial<Record<Factor, number>> = {};
  const tier = clean(input.tier);
  const availability = clean(input.availability);
  const risk = typeof input.countryRisk === "string" ? clean(input.countryRisk) : input.countryRisk;
  const numericRisk = typeof risk === "string" && risk !== "" ? Number(risk) : risk;

  if (tier && TIERS[tier]) subscores.tier = ((TIERS[tier] - 1) / 4) * 100;
  if (availability && AVAILABILITY[availability] !== undefined) subscores.availability = AVAILABILITY[availability];
  if (typeof numericRisk === "number" && Number.isFinite(numericRisk) && numericRisk >= 0 && numericRisk <= 100) {
    subscores.countryRisk = numericRisk;
  }
  if (typeof risk === "string" && RISK[risk] !== undefined) subscores.countryRisk = RISK[risk];
  if (input.reliability !== undefined && input.reliability >= 0 && input.reliability <= 100) {
    subscores.reliability = input.reliability;
  }
  return subscores;
}

export function normalizePrice(input: SupplierInput, fxRate = 1) {
  const midpoint = parsePrice(input.priceOriginal);
  const currency = clean(input.currency);
  const unit = clean(input.unit);
  if (midpoint === undefined) return { midpoint };
  if (!currency || !unit) return { midpoint, warning: "Price excluded: currency or unit missing" };
  if (!["usd", "bdt"].includes(currency)) return { midpoint, warning: "Price excluded: unsupported currency" };
  if (!unit.includes("kg") && !unit.includes("mt") && !unit.includes("ton")) {
    return { midpoint, warning: "Price excluded: unsupported unit" };
  }
  const usd = currency === "bdt" ? midpoint / Math.max(1, fxRate) : midpoint;
  return { midpoint, normalizedMidpoint: round(unit.includes("kg") ? usd * 1000 : usd), normalizedCurrency: "USD" as const, normalizedUnit: "per MT" as const };
}

export function landedCostByTerm(
  midpoint: number,
  deliveryTerms = "",
  freight: number,
  insurancePercent: number,
  dutyPercent: number,
  charges: number,
  fxRate = 1,
  vatPercent = 0,
  inlandTransport = 0,
) {
  const term = clean(deliveryTerms) ?? "";
  if (term.includes("local") || term.includes("warehouse")) return landedCost(midpoint, 0, 0, 0, 0, fxRate, vatPercent, inlandTransport);
  if (term.includes("cif")) return landedCost(midpoint, 0, 0, dutyPercent, charges, fxRate, vatPercent, inlandTransport);
  if (term.includes("cfr") || term.includes("cpt")) return landedCost(midpoint, 0, insurancePercent, dutyPercent, charges, fxRate, vatPercent, inlandTransport);
  return landedCost(midpoint, freight, insurancePercent, dutyPercent, charges, fxRate, vatPercent, inlandTransport);
}

function requiredDocs(country?: string) {
  return clean(country) === "bangladesh" ? ["invoice", "qc report"] : ["co", "bl", "insurance", "invoice", "qc report"];
}

function requestFitScore(result: ScoreResult, request?: RequestFit) {
  if (!request) return result;
  const scores: number[] = [];
  const flags = [...result.flags];
  const decisionTags: string[] = [];
  let splitSuggestion: string | undefined;

  if (request.product) {
    const match = clean(result.ingredient) === clean(request.product);
    scores.push(match ? 100 : 0);
    if (!match) flags.push("Rejected because product does not match request");
  }

  if (request.quantity && result.availableQuantity !== undefined) {
    scores.push(Math.min(100, (result.availableQuantity / request.quantity) * 100));
    if (result.availableQuantity < request.quantity) {
      splitSuggestion = `${result.supplier}: ${result.availableQuantity} + next supplier: ${request.quantity - result.availableQuantity}`;
      flags.push(`Split order suggestion: available ${result.availableQuantity} of ${request.quantity}`);
    }
  }
  if (request.quantity && result.moq !== undefined && request.quantity < result.moq) {
    scores.push(0);
    flags.push(`Rejected because order quantity is below MOQ ${result.moq}`);
  }

  if (request.requiredDate && result.leadTimeDays !== undefined) {
    const daysLeft = Math.ceil((new Date(request.requiredDate).getTime() - Date.now()) / 86_400_000);
    scores.push(result.leadTimeDays <= daysLeft ? 100 : 0);
    if (result.leadTimeDays > daysLeft) flags.push(`Rejected because lead time ${result.leadTimeDays} days misses required date`);
  }

  const comparisonPrice = result.normalizedMidpoint ?? result.midpoint;
  if (request.maxPrice && comparisonPrice !== undefined) {
    if (comparisonPrice > request.maxPrice) {
      scores.push(0);
      flags.push("Rejected because price is above max price");
    } else if (request.lowPrice && comparisonPrice <= request.lowPrice) scores.push(100);
    else if (request.averagePrice && comparisonPrice <= request.averagePrice) scores.push(90);
    else scores.push(70);
  }

  if (request.preferredCountry && result.country) {
    scores.push(clean(result.country) === clean(request.preferredCountry) ? 100 : 40);
  }

  const tolerance = request.riskTolerance ? RISK_ORDER[clean(request.riskTolerance) ?? ""] : undefined;
  const risk = typeof result.countryRisk === "string" ? RISK_ORDER[clean(result.countryRisk) ?? ""] : undefined;
  if (tolerance !== undefined && risk !== undefined) {
    scores.push(risk <= tolerance ? 100 : 0);
    if (risk > tolerance) flags.push("Rejected because country risk is above tolerance");
  }

  if (request.minReliability && result.reliability !== undefined) {
    scores.push(result.reliability >= request.minReliability ? 100 : 0);
    if (result.reliability < request.minReliability) flags.push("Rejected because reliability is below minimum");
  }

  if (request.supplierTypePreference && result.tier) {
    const match = clean(result.tier) === clean(request.supplierTypePreference);
    scores.push(match ? 100 : 50);
  }

  const specPairs: [keyof RequestFit, keyof SupplierInput, string][] = [
    ["moisture", "moisture", "moisture"],
    ["protein", "protein", "protein"],
    ["origin", "origin", "origin"],
    ["grade", "grade", "grade"],
    ["packaging", "packaging", "packaging"],
    ["qcRequirement", "qcNote", "QC requirement"],
  ];
  for (const [requestField, quoteField, label] of specPairs) {
    const wanted = request[requestField];
    const offered = result[quoteField];
    if (!wanted) continue;
    if (!offered) {
      flags.push(`Missing spec: ${label}`);
      scores.push(55);
    } else if (clean(String(offered))?.includes(clean(String(wanted)) ?? "")) scores.push(100);
    else {
      flags.push(`Spec warning: ${label} does not match request`);
      scores.push(25);
    }
  }

  const performance = request.supplierPerformance?.[supplierKey(result.supplier)];
  if (performance) {
    const latePenalty = Math.min(35, (performance.lateDeliveries ?? 0) * 7);
    const rejectPenalty = Math.min(40, (performance.rejectedShipments ?? 0) * 15);
    const accuracy = [performance.priceAccuracy, performance.documentAccuracy].filter((value): value is number => value !== undefined);
    scores.push(Math.max(0, (accuracy.length ? accuracy.reduce((sum, value) => sum + value, 0) / accuracy.length : 85) - latePenalty - rejectPenalty));
    if (performance.watchStatus === "watchlist") flags.push("Supplier is on watchlist");
    if (performance.watchStatus === "blacklist") flags.push("Blocked because supplier is blacklisted");
    if ((performance.lateDeliveries ?? 0) > 0) flags.push(`Performance warning: ${performance.lateDeliveries} late delivery count`);
    if ((performance.rejectedShipments ?? 0) > 0) flags.push(`Performance warning: ${performance.rejectedShipments} rejected shipment count`);
  }

  const docs = requiredDocs(result.country);
  const missingDocs = docs.filter((doc) => !hasText(result.documentsAvailable, doc));
  missingDocs.forEach((doc) => flags.push(`Missing document: ${doc}`));
  if (missingDocs.length) scores.push(Math.max(0, 100 - missingDocs.length * 18));

  const fit = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined;
  const quoteFields = [result.priceOriginal, result.currency, result.unit, result.availableQuantity, result.leadTimeDays, result.quoteValidityDate, result.paymentTerms, result.deliveryTerms, result.documentsAvailable, result.moisture, result.protein, result.origin, result.grade, result.packaging, result.qcNote];
  const confidence = round((quoteFields.filter((value) => value !== undefined && value !== "").length / quoteFields.length) * 100);

  if (result.quoteValidityDate) {
    const daysValid = Math.ceil((new Date(result.quoteValidityDate).getTime() - Date.now()) / 86_400_000);
    if (daysValid >= 0 && daysValid <= 7) flags.push("Quote expires soon");
    if (daysValid < 0) flags.push("Quote already expired");
  }
  if (result.leadTimeDays === undefined) flags.push("Missing lead time lowers confidence");
  if (result.availableQuantity === undefined) flags.push("Missing available quantity lowers confidence");

  if (fit !== undefined) {
    result.score = round(((result.score ?? fit) * 0.35) + (fit * 0.65));
  }
  if (flags.some((flag) => flag.startsWith("Rejected because lead time"))) result.score = Math.min(result.score ?? 0, 60);
  if (flags.some((flag) => flag.startsWith("Rejected because price is above max"))) result.score = Math.min(result.score ?? 0, 50);
  if (flags.some((flag) => flag.startsWith("Blocked because supplier is blacklisted"))) result.score = 0;
  if (performance?.watchStatus === "watchlist") result.score = Math.min(result.score ?? 0, 75);
  const finalConfidence = round(Math.max(0, confidence - missingDocs.length * 5 - (flags.some((flag) => flag.includes("unsupported")) ? 20 : 0)));
  const confidenceLabel: ScoreResult["confidenceLabel"] = finalConfidence >= 80 ? "Strong" : finalConfidence >= 55 ? "Medium" : "Weak";
  if (comparisonPrice !== undefined && request.lowPrice && comparisonPrice <= request.lowPrice) decisionTags.push("Cheapest but risky");
  if (result.leadTimeDays !== undefined) decisionTags.push("Fastest delivery candidate");
  if (clean(result.country) === "bangladesh") decisionTags.push("Best local supplier candidate");
  return { ...result, flags, confidence: finalConfidence, confidenceLabel, decisionTags, splitSuggestion };
}

export function scoreSuppliers(inputs: SupplierInput[], request?: RequestFit): ScoreResult[] {
  const groups = Map.groupBy(inputs, (input) => input.ingredient.trim().toLowerCase());
  const scored: ScoreResult[] = [];

  for (const group of groups.values()) {
    const normalized = group.map((input) => normalizePrice(input, request?.fxRate));
    const validPrices = normalized.map((item) => item.normalizedMidpoint).filter((value): value is number => value !== undefined);
    const min = validPrices.length ? Math.min(...validPrices) : undefined;
    const max = validPrices.length ? Math.max(...validPrices) : undefined;

    group.forEach((input, index) => {
      const { midpoint, normalizedMidpoint, normalizedCurrency, normalizedUnit, warning } = normalized[index];
      const subscores = fixedSubscores(input);
      const flags: string[] = [];

      if (warning) {
        flags.push(warning);
      } else if (normalizedMidpoint !== undefined && min !== undefined && max !== undefined) {
        subscores.price = min === max ? 100 : (100 * (max - normalizedMidpoint)) / (max - min);
        if (min === max) flags.push("No price spread");
      } else if (input.priceOriginal) {
        flags.push("Price excluded: invalid format");
      }

      if (input.tier && subscores.tier === undefined) flags.push(`Unmapped tier: ${input.tier}`);
      if (input.availability && subscores.availability === undefined) {
        flags.push(`Unmapped availability: ${input.availability}`);
      }
      if (input.countryRisk !== undefined && subscores.countryRisk === undefined) flags.push("Invalid country risk");
      if (input.reliability !== undefined && subscores.reliability === undefined) flags.push("Invalid reliability score");

      const factors = Object.keys(subscores) as Factor[];
      const presentWeight = factors.reduce((sum, factor) => sum + WEIGHTS[factor], 0);
      const contributions = Object.fromEntries(
        factors.map((factor) => [factor, round((WEIGHTS[factor] * subscores[factor]!) / presentWeight)]),
      ) as Partial<Record<Factor, number>>;
      const score = factors.length
        ? round(factors.reduce((sum, factor) => sum + WEIGHTS[factor] * subscores[factor]!, 0) / presentWeight)
        : undefined;

      scored.push(requestFitScore({
        ...input,
        midpoint,
        normalizedMidpoint,
        normalizedCurrency,
        normalizedUnit,
        subscores,
        contributions,
        score,
        completeness: round(presentWeight * 100),
        flags,
      }, request));
    });
  }

  for (const group of Map.groupBy(scored, (result) => result.ingredient.trim().toLowerCase()).values()) {
    const ordered = [...group].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const fastest = ordered.filter((result) => result.leadTimeDays !== undefined).sort((a, b) => a.leadTimeDays! - b.leadTimeDays!)[0];
    let previousScore: number | undefined;
    let previousRank = 0;
    ordered.forEach((result, index) => {
      const rank = result.score === previousScore ? previousRank : index + 1;
      result.rank = result.score === undefined ? undefined : rank;
      if (rank === 1) result.decisionTags = ["Best overall", ...(result.decisionTags ?? [])];
      if (fastest && result === fastest) result.decisionTags = [...(result.decisionTags ?? []), "Fastest delivery"];
      previousScore = result.score;
      previousRank = rank;
    });
    if (new Set(group.map((result) => Object.keys(result.subscores).sort().join("|"))).size > 1) {
      group.forEach((result) => result.flags.push("Partial comparison: factor sets differ"));
    }
  }

  return scored.sort(
    (a, b) => a.ingredient.localeCompare(b.ingredient) || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );
}

export function landedCost(
  midpoint: number,
  freight: number,
  insurancePercent: number,
  dutyPercent: number,
  charges: number,
  fxRate = 1,
  vatPercent = 0,
  inlandTransport = 0,
) {
  const base = (midpoint + midpoint * (insurancePercent / 100) + midpoint * (dutyPercent / 100)) * fxRate;
  return round(base + base * (vatPercent / 100) + freight + charges + inlandTransport);
}
