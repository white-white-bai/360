import type { Completion, CompletionRequest, ModelProvider } from "./types.ts";
import { costOf } from "./pricing.ts";

export interface LedgerRow {
  actor: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function emptyRow(actor: string): LedgerRow {
  return { actor, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

/**
 * Wraps a provider and keeps a per-actor ledger.
 *
 * A single total would not be enough. ADR 0004 requires that no actor verifies
 * its own output, so the actors are not interchangeable — and ADR 0001 accepts
 * v1 by comparing two conditions. "Which actor is expensive" is therefore as
 * load-bearing as "how expensive is a session", and both come from here.
 */
export class SpendMeter implements ModelProvider {
  #inner: ModelProvider;
  #rows: Map<string, LedgerRow>;

  constructor(inner: ModelProvider) {
    this.#inner = inner;
    this.#rows = new Map();
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const completion = await this.#inner.complete(req);
    const row = this.#rows.get(req.actor) ?? emptyRow(req.actor);
    row.calls += completion.usage.calls;
    row.inputTokens += completion.usage.inputTokens;
    row.outputTokens += completion.usage.outputTokens;
    row.costUsd += costOf(req.model, completion.usage.inputTokens, completion.usage.outputTokens);
    this.#rows.set(req.actor, row);
    return completion;
  }

  /** Rows, most expensive first — i.e. the ones worth cutting. */
  ledger(): LedgerRow[] {
    return [...this.#rows.values()].sort((a, b) => b.costUsd - a.costUsd);
  }

  total(): LedgerRow {
    const sum = emptyRow("TOTAL");
    for (const row of this.#rows.values()) {
      sum.calls += row.calls;
      sum.inputTokens += row.inputTokens;
      sum.outputTokens += row.outputTokens;
      sum.costUsd += row.costUsd;
    }
    return sum;
  }
}
