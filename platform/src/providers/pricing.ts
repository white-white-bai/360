export interface ModelPrice {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/**
 * PLACEHOLDER PRICES.
 *
 * These exist so the estimate can print a dollar figure instead of a bare token
 * count. They are NOT a quotation: they were not verified against any vendor's
 * current pricing, and they must be replaced with the prices of the model you
 * actually run before the number is used to decide anything.
 */
export const FALLBACK_PRICE: ModelPrice = {
  inputPerMTok: 3,
  outputPerMTok: 15,
};

export const PRICES: Record<string, ModelPrice> = {
  mid: FALLBACK_PRICE,
  cheap: { inputPerMTok: 0.5, outputPerMTok: 2 },
};

/**
 * Models whose price somebody actually supplied.
 *
 * Kept apart from `PRICES`, because being present in that table is not the same as being
 * real — `mid` and `cheap` are in there and are placeholders. Without this flag a run
 * against a model nobody has priced prints a dollar figure computed from invented
 * numbers, and nothing in the output says so: an estimate presented as a measurement,
 * which is the failure `usageEstimated` exists to prevent on the token side.
 */
const CONFIGURED = new Set<string>();

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? FALLBACK_PRICE;
}

/** True when this model's cost must be read as a placeholder rather than a measurement. */
export function isPlaceholderPrice(model: string): boolean {
  return !CONFIGURED.has(model);
}

/**
 * Register a model's real price, so the ledger reports money rather than tokens.
 *
 * The defaults above are placeholders and say so; this is how a run replaces them
 * with something an operator actually knows. Deliberately not read from the
 * environment in this module — configuration belongs to whoever starts the
 * provider, not to the price table.
 */
export function setPrice(model: string, price: ModelPrice): void {
  PRICES[model] = price;
  CONFIGURED.add(model);
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return (
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok
  );
}
