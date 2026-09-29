/**
 * The terminal Understanding Check (ADR 0003, ADR 0004).
 *
 * In Phase 1 a check is a HAND-AUTHORED ASSET under `domains/<id>/checks.md`,
 * not something generated per session. That is a stronger form of the
 * independence ADR 0004 demands: the check is written outside the explainer and
 * reviewed in a pull request, so there is no path by which the explainer can
 * shape the question that judges it.
 *
 * Per-session generated checks arrive with the real provider (Phase 4), where
 * they become a separate actor with its own ledger line.
 */
export interface MisconceptionDiagnosis {
  /** A phrase whose presence in the answer indicates this misconception. */
  marker: string;
  misconceptionId: string;
}

export interface UnderstandingCheck {
  id: string;
  /**
   * The situation put to the learner. Must differ from the situation the explanation
   * used — re-asking what was just said measures recall.
   *
   * This used to read "the transfer situation", from when a check was only ever the
   * transfer task. Transfer is now a separate measurement with its own asset, chosen by
   * the caller (ADR 0001), and calling every prompt a transfer would have made the two
   * impossible to tell apart.
   */
  prompt: string;
  expected: string;
  /** Corpus passage ids the answer must be consistent with (ADR 0004). */
  grounding: string[];
  diagnoses: MisconceptionDiagnosis[];
}

export interface CheckVerdict {
  checkId: string;
  verdict: "pass" | "fail";
  gradedBy: "objective";
  /**
   * Present on every failure. ADR 0004 requires a failure to say *how* the
   * learner got it wrong, because a challenger that guesses will refute a
   * position the learner does not hold — a strawman, which is worse than no
   * challenge at all.
   */
  diagnosis: { misconceptionId: string | null; reason: string } | null;
}
