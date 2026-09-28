import type { CompletionRequest } from "../providers/types.ts";
import { fillerForTokens } from "../util/tokens.ts";

/**
 * The drivers of a session's cost. These are the numbers to argue with: each
 * one is a claim about how big something is, and the estimate is only as good
 * as they are. Kept in one place so they can be corrected from real
 * measurements without touching the shape definitions.
 */
export const DRIVERS = {
  /** Corpus passages pulled in for one Assertion List. */
  corpusExcerptTokens: 3000,
  /** Persona + Style + the instruction scaffolding. */
  framingTokens: 500,
  assertionListTokens: 700,
  narrationTokens: 2200,
  learnerAnswerTokens: 120,
  probeCount: 6,
  probeTokens: 60,
  probeEvaluationTokens: 60,
  checkAuthoringTokens: 250,
  checkGradingTokens: 250,
  misconceptionTokens: 300,
  challengerTokens: 450,
} as const;

export interface CallShape {
  label: string;
  request: CompletionRequest;
}

export interface SessionShape {
  id: string;
  label: string;
  calls: CallShape[];
}

function call(
  actor: string,
  model: string,
  label: string,
  inputTokens: number,
  outputTokens: number,
): CallShape {
  return {
    label,
    request: {
      actor,
      model,
      input: fillerForTokens(inputTokens),
      expectedOutputTokens: outputTokens,
    },
  };
}

const MODEL = "mid";

/**
 * Baseline, per ADR 0001: one strong explainer plus the terminal check, with no
 * apparatus at all. This is the comparison object and the cheaper path.
 */
export function baselineShape(): SessionShape {
  const d = DRIVERS;
  return {
    id: "baseline",
    label: "one explainer + terminal check, no apparatus",
    calls: [
      call("lead-explainer", MODEL, "explain", d.corpusExcerptTokens + d.framingTokens + 300, d.narrationTokens),
      call("check-author", MODEL, "author terminal check", d.narrationTokens + d.corpusExcerptTokens + 200, d.checkAuthoringTokens),
      call("check-grader", MODEL, "grade terminal check", d.checkAuthoringTokens + d.learnerAnswerTokens + d.corpusExcerptTokens, d.checkGradingTokens),
    ],
  };
}

/**
 * Apparatus, per ADRs 0003-0006: two-phase generation, grounding verification,
 * inline probes, an independently authored check, and a challenger that may or
 * may not fire.
 *
 * Note what `narrate` and `re-teach` do NOT carry: the corpus. That is ADR
 * 0005's two-phase design paying for itself — verification happened on the
 * Assertion List, so realisation does not re-send the corpus.
 */
export function apparatusShape(): SessionShape {
  const d = DRIVERS;
  const calls: CallShape[] = [
    call("lead-explainer", MODEL, "emit assertion list", d.corpusExcerptTokens + d.framingTokens + 300, d.assertionListTokens),
    call("grounding-verifier", MODEL, "verify list against corpus", d.assertionListTokens + d.corpusExcerptTokens, 300),
    call("lead-explainer", MODEL, "realise narration (no corpus)", d.assertionListTokens + d.framingTokens, d.narrationTokens),
  ];

  for (let i = 1; i <= d.probeCount; i += 1) {
    calls.push(
      call(
        "probe-evaluator",
        MODEL,
        `evaluate probe ${i}`,
        d.probeTokens + d.learnerAnswerTokens,
        d.probeEvaluationTokens,
      ),
    );
  }

  calls.push(
    call("check-author", MODEL, "author terminal check", d.assertionListTokens + d.corpusExcerptTokens + 200, d.checkAuthoringTokens),
    call("check-grader", MODEL, "grade terminal check", d.checkAuthoringTokens + d.learnerAnswerTokens + d.corpusExcerptTokens, d.checkGradingTokens),
    call("challenger", MODEL, "refute misconception", d.misconceptionTokens + d.learnerAnswerTokens, d.challengerTokens),
    call("lead-explainer", MODEL, "re-teach (same list, new realisation)", d.assertionListTokens + d.framingTokens, d.narrationTokens),
  );

  return { id: "apparatus", label: "full stack", calls };
}

export function allShapes(): SessionShape[] {
  return [baselineShape(), apparatusShape()];
}
