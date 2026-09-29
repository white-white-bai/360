import type { Completion, CompletionRequest, ModelProvider, StreamEvent, Usage } from "./types.ts";
import { costOf, isPlaceholderPrice } from "./pricing.ts";
import { estimateTokens } from "../util/tokens.ts";

export interface LedgerRow {
  actor: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * False when any call in this row was priced from the placeholder table.
   *
   * `costUsd` is still a number and still looks like money, so the flag is what stops a
   * run against an unpriced model from reporting a figure nobody measured. It is a
   * property of the row rather than of the run because the rows are per actor, and
   * "which actor is expensive" is the question this ledger exists to answer.
   */
  priced: boolean;
}

function emptyRow(actor: string): LedgerRow {
  return { actor, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, priced: true };
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

  /** The one place a call turns into money, whatever shape the call arrived in. */
  #record(req: CompletionRequest, usage: Usage): void {
    const row = this.#rows.get(req.actor) ?? emptyRow(req.actor);
    row.calls += usage.calls;
    row.inputTokens += usage.inputTokens;
    row.outputTokens += usage.outputTokens;
    row.costUsd += costOf(req.model, usage.inputTokens, usage.outputTokens);
    row.priced = row.priced && !isPlaceholderPrice(req.model);
    this.#rows.set(req.actor, row);
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const completion = await this.#inner.complete(req);
    this.#record(req, completion.usage);
    return completion;
  }

  /**
   * A streamed call is metered by the same rule as a buffered one.
   *
   * When the provider cannot stream, the buffered call is what happens — and it is
   * recorded once, here, rather than by delegating to `complete` and counting it
   * twice. Both paths exist so that switching a provider from buffered to streaming
   * cannot change the cost report, which would make the acceptance experiment
   * incomparable between conditions that used different providers.
   */
  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const inner = this.#inner;
    if (inner.stream === undefined) {
      const completion = await inner.complete(req);
      this.#record(req, completion.usage);
      yield { kind: "delta", text: completion.text };
      yield { kind: "usage", usage: completion.usage };
      return;
    }

    let text = "";
    let usage: Usage | null = null;
    for await (const event of inner.stream(req)) {
      if (event.kind === "delta") {
        text += event.text;
        yield event;
        continue;
      }
      usage = event.usage;
    }

    // A provider that streams but reports nothing still has to be accounted for. The
    // estimate keeps the ledger populated; `usageEstimated` on the adapter is where
    // it gets said out loud.
    const final: Usage = usage ?? {
      calls: 1,
      inputTokens: estimateTokens(`${req.system ?? ""}\n${req.input}`),
      outputTokens: estimateTokens(text),
    };
    this.#record(req, final);
    yield { kind: "usage", usage: final };
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
      sum.priced = sum.priced && row.priced;
    }
    return sum;
  }
}
