import type { CheckVerdict, UnderstandingCheck } from "./types.ts";

/**
 * The narrowest normalisation that still tolerates typing differences.
 *
 * NFKC folds width and compatibility variants (a full-width digit typed on a
 * Chinese IME becomes an ASCII digit), whitespace collapses, and ASCII case is
 * folded. Nothing else is allowed: no stemming, no synonyms, no fuzzy distance.
 *
 * That restraint is deliberate. Any looser comparison stops being "was the
 * answer right?" and becomes "was the answer close enough?", which is a
 * judgement call — and judgement calls belong to model grading, which carries
 * an obligation to cite the corpus passage it relied on. An objective check
 * that quietly approximates would launder that judgement into a deterministic
 * verdict, and a wrong verdict here is worse than no verdict: the learner
 * cannot tell.
 */
export function normaliseAnswer(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function gradeObjectively(check: UnderstandingCheck, answer: string): CheckVerdict {
  const normalised = normaliseAnswer(answer);

  if (normalised === "") {
    return {
      checkId: check.id,
      verdict: "fail",
      gradedBy: "objective",
      diagnosis: { misconceptionId: null, reason: "没有作答" },
    };
  }

  if (normalised === normaliseAnswer(check.expected)) {
    return { checkId: check.id, verdict: "pass", gradedBy: "objective", diagnosis: null };
  }

  // Order matters: the first catalogue entry whose marker appears wins.
  for (const diagnosis of check.diagnoses) {
    if (normalised.includes(normaliseAnswer(diagnosis.marker))) {
      return {
        checkId: check.id,
        verdict: "fail",
        gradedBy: "objective",
        diagnosis: {
          misconceptionId: diagnosis.misconceptionId,
          reason: `答案包含「${diagnosis.marker}」，命中已编目的错误直觉`,
        },
      };
    }
  }

  // A failure with no named misconception is a real outcome, and ADR 0004 says
  // what to do about it: ask the learner to explain, rather than guess at a
  // mental model and risk refuting something they never believed.
  return {
    checkId: check.id,
    verdict: "fail",
    gradedBy: "objective",
    diagnosis: {
      misconceptionId: null,
      reason: "答案既不正确，也不匹配任何已编目的错误直觉——应先问学习者为什么这样回答",
    },
  };
}
