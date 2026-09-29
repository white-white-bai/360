/**
 * The JSON contracts the apparatus's actors speak.
 *
 * Every one of these is model output, so every one is a trust boundary: parsed,
 * shape-checked and refused loudly rather than assumed. The parsers live here
 * together because the interesting thing about them is what they *share* — each
 * is the same discipline applied to a different actor.
 */

import type { AssertionList } from "../assertions/types.ts";
import { parseAssertionList } from "../assertions/parse.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    // The raw text is part of the message. A model that returns malformed JSON returns it
    // in ways nobody predicts — a missing comma, a fence, a truncated string — and a parser
    // that reports only an offset leaves the reader guessing at what actually arrived. The
    // first live run against a real model stopped here with "position 33" and nothing else,
    // which is a diagnostic that costs another round of real calls to replace.
    throw new Error(
      `${what} is not valid JSON: ${(error as Error).message}\n` +
        `--- what arrived (${text.length} chars) ---\n${text.slice(0, 800)}`,
    );
  }
}

function nonEmptyString(value: unknown, at: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${at} must be a non-empty string`);
  }
  return value;
}

// --------------------------------------------------------- semantic verifier --

/**
 * The independent verifier's per-assertion judgement.
 *
 * This is the half the kernel cannot do: whether a claim actually *follows from*
 * the passage it cites. It is a separate actor on purpose — see the boundary note
 * in grounding/verify.ts.
 */
export interface SemanticVerdict {
  id: string;
  ok: boolean;
  reason: string;
}

export function parseSemanticVerdicts(text: string): SemanticVerdict[] {
  const parsed = parseJson(text, "semantic verdicts");
  if (!isRecord(parsed) || !Array.isArray(parsed.verdicts)) {
    throw new Error("semantic verdicts must be an object with a `verdicts` array");
  }
  if (parsed.verdicts.length === 0) {
    throw new Error("semantic verdicts is empty — an unexamined list must not read as a passing one");
  }

  const seen = new Set<string>();
  return parsed.verdicts.map((raw, index) => {
    const at = `semantic verdict ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const id = nonEmptyString(raw.id, `${at} \`id\``);
    if (seen.has(id)) throw new Error(`duplicate semantic verdict for ${JSON.stringify(id)}`);
    seen.add(id);
    if (typeof raw.ok !== "boolean") throw new Error(`${at} \`ok\` must be a boolean`);
    return { id, ok: raw.ok, reason: typeof raw.reason === "string" ? raw.reason : "" };
  });
}

// --------------------------------------------------------------------- probes --

/**
 * A probe (ADR 0013): cheap, frequent, ungraded.
 *
 * `afterAssertion` is what keeps it inline — the narration places each probe
 * after the claim it is about, rather than bunching them at the end where they
 * would read as a quiz.
 */
export interface Probe {
  id: string;
  afterAssertion: string;
  prompt: string;
}

export function parseProbes(text: string): Probe[] {
  const parsed = parseJson(text, "probes");
  if (!isRecord(parsed) || !Array.isArray(parsed.probes)) {
    throw new Error("probes must be an object with a `probes` array");
  }

  const seen = new Set<string>();
  return parsed.probes.map((raw, index) => {
    const at = `probe ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const id = nonEmptyString(raw.id, `${at} \`id\``);
    if (seen.has(id)) throw new Error(`duplicate probe id ${JSON.stringify(id)}`);
    seen.add(id);
    return {
      id,
      afterAssertion: nonEmptyString(raw.afterAssertion, `${at} \`afterAssertion\``),
      prompt: nonEmptyString(raw.prompt, `${at} \`prompt\``),
    };
  });
}

// ------------------------------------------------------------ probe outcomes --

/**
 * What a probe's answer revealed.
 *
 * Note what is absent: a score. ADR 0013 is explicit that a probe produces no
 * score and blocks nothing — its only job is to surface a misconception early
 * enough to be worth refuting, so the useful output is `concern` plus a named
 * misconception, never a mark.
 */
export interface ProbeOutcome {
  probeId: string;
  concern: boolean;
  reason: string;
  misconceptionId: string | null;
}

export function parseProbeOutcome(text: string, probeId: string): ProbeOutcome {
  const parsed = parseJson(text, `probe outcome for ${probeId}`);
  if (!isRecord(parsed)) throw new Error(`probe outcome for ${probeId} must be an object`);
  if (typeof parsed.concern !== "boolean") {
    throw new Error(`probe outcome for ${probeId} \`concern\` must be a boolean`);
  }
  const misconceptionId =
    typeof parsed.misconceptionId === "string" && parsed.misconceptionId.trim() !== ""
      ? parsed.misconceptionId
      : null;
  return {
    probeId,
    concern: parsed.concern,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    misconceptionId,
  };
}

// ------------------------------------------------------------ in-lesson asks --

/**
 * What the explainer intends to do about a question asked mid-lesson (ADR 0008).
 *
 * Either the claims the answer rests on — verified before anything is said, exactly
 * like the lesson — or an explicit decline. The decline is a first-class reply (ADR
 * 0004): the model is given a way to say "out of Domain" BEFORE it writes claims, so
 * a question this Domain cannot answer does not have to produce a fabricated
 * citation first and be caught afterwards.
 */
export type AnswerPlan =
  | { kind: "claims"; list: AssertionList }
  | { kind: "decline"; reason: string };

export function parseAnswerPlan(text: string, domainId: string): AnswerPlan {
  const parsed = parseJson(text, "answer plan");
  if (isRecord(parsed) && typeof parsed.cannotAnswer === "string" && parsed.cannotAnswer.trim() !== "") {
    return { kind: "decline", reason: parsed.cannotAnswer };
  }
  return { kind: "claims", list: parseAssertionList(text, domainId) };
}
