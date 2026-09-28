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

export interface ModelProvider {
  complete(req: CompletionRequest): Promise<Completion>;
}
