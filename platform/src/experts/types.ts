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

export interface Misconception {
  id: string;
  name: string;
  /** The wrong mental model, stated as the learner would hold it. */
  wrongModel: string;
  /** How it is refuted. */
  refutation: string;
  /** Checks that can diagnose it. Empty is allowed in Phase 1; the validator flags it. */
  diagnosedBy: string[];
}

export interface Domain {
  id: string;
  name: string;
  /** A named person, not a team (ADR 0006). */
  owner: string;
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

export function describeExpert(expert: Expert): string {
  return `${expert.persona.name} / ${expert.domain.name} / ${expert.style.name}`;
}
