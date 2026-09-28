import type { AssertionList } from "../assertions/types.ts";
import type { Corpus } from "./corpus.ts";
import { findPassage } from "./corpus.ts";

/**
 * The kernel's STRUCTURAL verification of an assertion list.
 *
 * It answers one question: does every claim that says it is grounded actually
 * point at a passage this Domain has? That is decidable, so it is free,
 * deterministic and runs before anything is said. ADR 0005's two-phase design
 * depends on it — the narration is only allowed to start once the list passes.
 *
 * What it deliberately does NOT do is decide whether a claim *follows from* the
 * passage it cites. That is a semantic judgement, and ADR 0004 forbids the actor
 * that produced the claim from making it. So it belongs to a separate verifier
 * actor, which is a model call and therefore a different module. Merging the two
 * here would be the exact self-verification the rule exists to prevent — and it
 * would make this function look stronger than it is.
 */
export interface AssertionVerdict {
  id: string;
  ok: boolean;
  /** Empty when ok; otherwise what is wrong, naming the passage when relevant. */
  reason: string;
}

export interface ListVerdict {
  /** True only when every assertion passed. */
  ok: boolean;
  verdicts: AssertionVerdict[];
  /** Ids of the assertions that failed, for a retry or a report. */
  failed: string[];
}

export function verifyAssertionList(list: AssertionList, corpus: Corpus): ListVerdict {
  const verdicts: AssertionVerdict[] = list.assertions.map((assertion) => {
    // The parser already guarantees this shape, but the list may also arrive from
    // storage or from a caller that built it by hand, so the check is repeated
    // here rather than assumed.
    if (assertion.kind === "grounded" && assertion.sources.length === 0) {
      return { id: assertion.id, ok: false, reason: "grounded assertion cites no passage" };
    }
    if (assertion.kind === "scaffold" && assertion.sources.length > 0) {
      return { id: assertion.id, ok: false, reason: "scaffold cites passages" };
    }

    const unresolved = assertion.sources.filter((id) => findPassage(corpus, id) === undefined);
    if (unresolved.length > 0) {
      return {
        id: assertion.id,
        ok: false,
        reason: `cites passages this Domain does not have: ${unresolved.map((id) => JSON.stringify(id)).join(", ")}`,
      };
    }

    return { id: assertion.id, ok: true, reason: "" };
  });

  const failed = verdicts.filter((v) => !v.ok).map((v) => v.id);
  return { ok: failed.length === 0, verdicts, failed };
}

/** The passages a list actually leans on, in first-use order. */
export function citedPassages(list: AssertionList): string[] {
  const seen: string[] = [];
  for (const assertion of list.assertions) {
    for (const id of assertion.sources) {
      if (!seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}
