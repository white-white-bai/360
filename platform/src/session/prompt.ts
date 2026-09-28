import type { Expert } from "../experts/types.ts";
import { excerpt } from "../grounding/corpus.ts";

/**
 * The blocks every actor's prompt shares.
 *
 * Kept in one place because the three axes must appear *separately* in every
 * prompt (ADR 0006): if an actor is told "you are the patient explainer for time
 * zones" in one sentence, the axes have quietly fused back into a single blob and
 * the reason for splitting them is gone.
 */
export function framing(expert: Expert): string {
  const { persona, style, domain } = expert;
  return [
    "# Persona — who is speaking",
    `name: ${persona.name}`,
    `stance: ${persona.stance}`,
    `register: ${persona.register}`,
    "",
    "# Style — how the explanation is built",
    `analogyDensity: ${style.analogyDensity}`,
    `order: ${style.order}`,
    `abstraction: ${style.abstraction}`,
    `exampleType: ${style.exampleType}`,
    "",
    `# Domain — what may be asserted (${domain.name})`,
    "Every statement about the world must be supported by one of the corpus passages below.",
    "Anything the passages do not support must be dropped or openly marked as an analogy,",
    "never asserted. If the passages do not settle something, say you do not know.",
    "",
    `# Delivery language: ${domain.deliveryLanguage}`,
    "The corpus is in its source language. Teach in the delivery language, render terms exactly",
    "as the Term Glossary gives them, and reproduce never-translate identifiers unchanged.",
  ].join("\n");
}

export function corpusBlock(expert: Expert): string {
  return [
    "# Corpus passages",
    ...excerpt(expert.domain.corpus).map((p) => `## ${p.id}\nsource: ${p.source}\ntext: ${p.text}`),
  ].join("\n");
}

export function glossaryBlock(expert: Expert): string {
  return [
    "# Term Glossary",
    ...Object.entries(expert.domain.glossary.terms).map(([term, rendering]) => `${term} => ${rendering}`),
    `never translate: ${expert.domain.glossary.neverTranslate.join(", ")}`,
  ].join("\n");
}

export function misconceptionBlock(expert: Expert): string {
  return [
    "# Misconception catalogue",
    ...expert.domain.misconceptions.map((m) => `## ${m.id}\nname: ${m.name}\nwrong model: ${m.wrongModel}\nrefutation: ${m.refutation}`),
  ].join("\n");
}

export const BLACKBOARD_CONTRACT = [
  "# Blackboard vocabulary (closed — nothing outside this list)",
  "- text:  {id, body}",
  "- shape: {id, shape: rect|ellipse|arrow|line, from, to}   from/to are element ids",
  "- axis:  {id, label, from, to, marks:[{value, label?}]}   a scale; numbers are domain values",
  "- band:  {id, axis, from, to, label, emphasis: neutral|attention}   a span on an axis",
  "- table: {id, columns:[...], rows:[[...]]}   rows must match the column count",
  "- point / highlight / erase: {target}   focus, mark or remove an existing element",
  "- rich:  {id, format: mermaid|excalidraw|svg, body, declared: true}",
].join("\n");
