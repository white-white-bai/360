/**
 * The three axes of an Expert (ADR 0006 / CONTEXT.md).
 *
 *   Persona — who is speaking
 *   Domain  — what may be asserted, and therefore where it must admit ignorance
 *   Style   — how the explanation is built
 *
 * They are separate types, not fields of one blob, because the whole point of
 * the split is that each can be swapped without touching the others. A retry
 * that changes the explanation must be able to change Style while Domain stays
 * put; if these were one structure, "explain it differently" would silently
 * become "different teacher".
 */

import type { Corpus } from "../grounding/corpus.ts";
import type { UnderstandingCheck } from "../checks/types.ts";
import { isPlaceholder } from "../util/placeholder.ts";

export interface Persona {
  id: string;
  name: string;
  /** Stance, register, formality — how it addresses the learner. */
  stance: string;
  register: string;
}

export interface Style {
  id: string;
  name: string;
  /** How densely analogies are used. */
  analogyDensity: "low" | "medium" | "high";
  /** Whether the explanation leads with the conclusion or with the motivation. */
  order: "conclusion-first" | "motivation-first";
  abstraction: "concrete" | "balanced" | "abstract";
  exampleType: string;
}

/**
 * Note the absence of a `diagnosedBy` field.
 *
 * Which checks detect a misconception is already stated by each check's
 * `diagnoses`, and a second copy here could only ever drift out of agreement
 * with the first. So one direction of the relation is written down and the other
 * is derived — by the validator, which fails if an entry below cannot be reached.
 */
export interface Misconception {
  id: string;
  name: string;
  /** The wrong mental model, stated as the learner would hold it. */
  wrongModel: string;
  /** How it is refuted. */
  refutation: string;
}

export interface Domain {
  id: string;
  name: string;
  /** A named person, not a team (ADR 0006). */
  owner: string;
  /**
   * Who signed off on the corpus, and when.
   *
   * Two kinds of evidence live here and they are deliberately separate: a machine
   * comparison (recorded in the corpus file's header) says a script read the cited
   * documents and reported; this says a person accepted that report. Neither
   * substitutes for the other.
   *
   * Stored as fields rather than left in a comment, because a comment cannot be
   * checked — and "the banner is gone" is not the same claim as "someone vouched
   * for this". The validator requires both to be present.
   */
  corpusReviewedBy: string;
  corpusReviewedOn: string;
  /**
   * The SECOND reviewer, and the only field pair that can open a high-risk
   * Profession (ADR 0017).
   *
   * Optional on load, deliberately: the Domains that existed before the second
   * signature did are single-reviewed, which is what they always were, and
   * requiring these fields would have made every one of them unloadable rather
   * than honestly under-backed. A pair that is half-filled, or that repeats the
   * first name, is refused — by `hasTwoReviewers` below for the status
   * computation, and by the validator (`corpus.second-review-invalid`) which
   * says so out loud.
   *
   * What this CANNOT record is independence. Two names in a file are two names;
   * that they are two people is an attestation by the Owner, not a fact the
   * platform can read (ADR 0017 decision 2). The rule is named for what it
   * checks, not for what it hopes.
   */
  secondReviewedBy?: string;
  secondReviewedOn?: string;
  /** Language the teaching is delivered in; the corpus stays in its source language. */
  deliveryLanguage: string;
  sources: string[];
  corpus: Corpus;
  misconceptions: Misconception[];
  /**
   * Terminal checks for this Domain. Hand-authored assets rather than something
   * generated per session, so the explainer has no path to shaping the exam that
   * judges it (ADR 0004).
   */
  checks: UnderstandingCheck[];
  /** term -> approved rendering. Identifiers that are never translated live in `neverTranslate`. */
  glossary: { terms: Record<string, string>; neverTranslate: string[] };
}

export interface Expert {
  persona: Persona;
  style: Style;
  domain: Domain;
}

/**
 * Whether a Domain carries a second reviewer — the ONE predicate that decides
 * co-signing (ADR 0017).
 *
 * The loader, the validator, the status computation, the coverage report and
 * both doors all read this function rather than deriving the fact again, because
 * four derivations of "is this co-signed" is four chances for the page and the
 * validator to disagree about which lines are open.
 *
 * It answers a narrow question on purpose. `true` means two different names are
 * recorded here and neither is scaffold text. It does NOT mean two people read
 * the corpus — nothing in a file can mean that, and a predicate whose name
 * promised it would be the first lie in an ADR built to avoid one.
 */
export function hasTwoReviewers(domain: Domain): boolean {
  const first = domain.corpusReviewedBy;
  const second = domain.secondReviewedBy;
  if (isPlaceholder(second) || isPlaceholder(domain.secondReviewedOn)) return false;
  return second !== first;
}

export function describeExpert(expert: Expert): string {
  return `${expert.persona.name} / ${expert.domain.name} / ${expert.style.name}`;
}
