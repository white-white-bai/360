/**
 * The Assertion List (ADR 0005).
 *
 * This is the artifact that makes "verify before you speak" possible: the
 * explainer says what it intends to claim, the claims are checked, and only then
 * is any narration written.
 *
 * The distinction between the two kinds is the whole point, and it is the
 * distinction ADR 0004 draws:
 *
 *   grounded — a claim about the world. It must name the corpus passages it
 *              follows from, and the kernel refuses it if they do not resolve.
 *   scaffold — an analogy, a framing, a worked example. It is allowed to be
 *              ungrounded, and it must be marked so that it is never delivered
 *              as though it were a fact.
 *
 * A list where everything is `grounded` is suspicious in the other direction:
 * teaching without any scaffold is usually a lecture of bare assertions.
 */
export type AssertionKind = "grounded" | "scaffold";

export interface Assertion {
  id: string;
  kind: AssertionKind;
  /** The claim, phrased as a statement — not a topic, and not a question. */
  statement: string;
  /**
   * Corpus passage ids. Required and non-empty for `grounded`; must be empty for
   * `scaffold`, because a scaffold that cites sources is a grounded assertion
   * wearing the wrong label.
   */
  sources: string[];
}

export interface AssertionList {
  domainId: string;
  assertions: Assertion[];
}

export function grounded(list: AssertionList): Assertion[] {
  return list.assertions.filter((a) => a.kind === "grounded");
}

export function scaffolds(list: AssertionList): Assertion[] {
  return list.assertions.filter((a) => a.kind === "scaffold");
}
