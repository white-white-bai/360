/** Token accounting for one model call. */
export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  /**
   * Who is asking. Not decoration: ADR 0004's rule is that no actor verifies
   * its own output, so the ledger has to attribute every call to an actor.
   */
  actor: string;
  model: string;
  system?: string;
  input: string;
  /** Size the caller expects back. Real providers ignore it; the fake honours it. */
  expectedOutputTokens?: number;
}

export interface Completion {
  text: string;
  usage: Usage;
}

/**
 * What a streaming turn emits.
 *
 * Usage arrives as its own event rather than being inferred from the text: a
 * streamed call and a buffered one must not land in the ledger under different
 * rules, and an estimated cost presented as a measured one is the exact failure the
 * `usageEstimated` flag exists to prevent.
 */
export type StreamEvent = { kind: "delta"; text: string } | { kind: "usage"; usage: Usage };

export interface ModelProvider {
  complete(req: CompletionRequest): Promise<Completion>;
  /**
   * Providers that can deliver a turn incrementally.
   *
   * Optional on purpose: the blackboard wants each step as it is finished (ADR 0005),
   * but nothing in the teaching loop requires streaming — a provider that can only
   * answer in one piece is still a valid provider, and the session falls back to it.
   */
  stream?(req: CompletionRequest): AsyncIterable<StreamEvent>;
}
