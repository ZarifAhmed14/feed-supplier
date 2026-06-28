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
};

export type Factor = "price" | "tier" | "availability" | "countryRisk" | "reliability";

export type ScoreResult = SupplierInput & {
  midpoint?: number;
  subscores: Partial<Record<Factor, number>>;
  contributions: Partial<Record<Factor, number>>;
  score?: number;
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

const clean = (value?: string) => value?.trim().toLowerCase();
const round = (value: number) => Math.round(value * 100) / 100;

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

export function scoreSuppliers(inputs: SupplierInput[]): ScoreResult[] {
  const groups = Map.groupBy(inputs, (input) => input.ingredient.trim().toLowerCase());
  const scored: ScoreResult[] = [];

  for (const group of groups.values()) {
    const midpoints = group.map((input) => parsePrice(input.priceOriginal));
    const priceBases = new Set(
      group
        .filter((input, index) => midpoints[index] !== undefined && input.currency && input.unit)
        .map((input) => `${clean(input.currency)}|${clean(input.unit)}`),
    );
    const comparablePrices = priceBases.size <= 1;
    const validPrices = comparablePrices
      ? midpoints.filter((value, index): value is number => value !== undefined && Boolean(group[index].currency && group[index].unit))
      : [];
    const min = validPrices.length ? Math.min(...validPrices) : undefined;
    const max = validPrices.length ? Math.max(...validPrices) : undefined;

    group.forEach((input, index) => {
      const midpoint = midpoints[index];
      const subscores = fixedSubscores(input);
      const flags: string[] = [];

      if (!comparablePrices && midpoint !== undefined) {
        flags.push("Price excluded: mixed currency or unit in category");
      } else if (midpoint !== undefined && input.currency && input.unit && min !== undefined && max !== undefined) {
        subscores.price = min === max ? 100 : (100 * (max - midpoint)) / (max - min);
        if (min === max) flags.push("No price spread");
      } else if (input.priceOriginal && (!input.currency || !input.unit)) {
        flags.push("Price excluded: currency or unit missing");
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

      scored.push({
        ...input,
        midpoint,
        subscores,
        contributions,
        score,
        completeness: round(presentWeight * 100),
        flags,
      });
    });
  }

  for (const group of Map.groupBy(scored, (result) => result.ingredient.trim().toLowerCase()).values()) {
    const ordered = [...group].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    let previousScore: number | undefined;
    let previousRank = 0;
    ordered.forEach((result, index) => {
      const rank = result.score === previousScore ? previousRank : index + 1;
      result.rank = result.score === undefined ? undefined : rank;
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
