import type { Library } from "./load.ts";
import { composeExpert } from "./load.ts";
import type { Domain, Expert, Persona, Style } from "./types.ts";

/**
 * What the Catalogue offers, in the order a learner meets it (ADR 0007).
 *
 * Two steps: pick a Domain, then pick how it is taught. Nothing here names a default,
 * and that is the decision, not an oversight — a per-Domain default would quietly
 * re-fuse Style to Domain, and a Style the Domain owns is not an axis any more. The
 * platform also has no ground truth to guess from: two learners facing the same
 * material may want the analogy-heavy walkthrough or the terse one, and a default
 * would be the platform guessing on their behalf and never finding out it guessed
 * wrong.
 */
export interface EntryOption {
  id: string;
  label: string;
  /** One line to read before choosing. */
  detail: string;
}

export interface Catalogue {
  domains: EntryOption[];
  personas: EntryOption[];
  styles: EntryOption[];
}

function domainOption(domain: Domain): EntryOption {
  const terms = Object.keys(domain.glossary.terms).length;
  return {
    id: domain.id,
    label: domain.name,
    detail: `${domain.checks.length} 项检查 · ${domain.misconceptions.length} 条误解 · 术语 ${terms} 条 · 授课语言 ${domain.deliveryLanguage}`,
  };
}

function personaOption(persona: Persona): EntryOption {
  return { id: persona.id, label: persona.name, detail: `${persona.stance} · ${persona.register}` };
}

function styleOption(style: Style): EntryOption {
  return {
    id: style.id,
    label: style.name,
    detail: `${style.order} · 抽象度 ${style.abstraction} · 类比密度 ${style.analogyDensity} · 例子 ${style.exampleType}`,
  };
}

export function catalogue(library: Library): Catalogue {
  const byLabel = (a: EntryOption, b: EntryOption): number => a.label.localeCompare(b.label);
  return {
    domains: [...library.domains.values()].map(domainOption).sort(byLabel),
    personas: [...library.personas.values()].map(personaOption).sort(byLabel),
    styles: [...library.styles.values()].map(styleOption).sort(byLabel),
  };
}

/** Thrown when a choice was not on offer, so a caller can ask again rather than guess. */
export class NotOffered extends Error {}

/**
 * Resolve a typed topic to something the catalogue or the draft shelf holds (ADR 0010) —
 * conservatively, because a wrong match is worse than none: an unmatched topic goes to the
 * builder, while a mis-route teaches the wrong subject with full confidence. Matching is
 * containment on the id and on whole name fragments, never fuzzy distance. Latin fragments are
 * not split — `utf` out of `UTF-8` would match `utf16`, which is exactly the mis-route this
 * refuses to make.
 */
export type TopicMatch =
  | { kind: "one"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; ids: string[] };

/** Anything a typed topic can resolve against: a Domain, or a draft waiting for a signature. */
export interface TopicEntry {
  id: string;
  name: string;
}

const normaliseTopic = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\s\u3000、，。·,.\-–—:：()（）]+/g, "");

function segmentsOf(entry: TopicEntry): string[] {
  const pieces = new Set<string>();
  const id = normaliseTopic(entry.id);
  if (id.length >= 2) pieces.add(id);
  const whole = normaliseTopic(entry.name);
  if (whole.length >= 2) pieces.add(whole);
  // Split on Chinese list punctuation and connectives only; a name fragment like «时区» is
  // what lets "时区到底是什么" resolve without loosening the match any further.
  for (const part of entry.name.split(/[、，。·：（）()与和及]+/)) {
    const normalised = normaliseTopic(part);
    if (normalised.length >= 2) pieces.add(normalised);
  }
  return [...pieces];
}

export function matchTopic(entries: readonly TopicEntry[], topic: string): TopicMatch {
  const needle = normaliseTopic(topic);
  if (needle.length < 2) return { kind: "none" };

  const hits = entries.filter((entry) =>
    segmentsOf(entry).some((segment) => needle.includes(segment) || segment.includes(needle)),
  );

  if (hits.length === 1) return { kind: "one", id: (hits[0] as TopicEntry).id };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "ambiguous", ids: hits.map((entry) => entry.id).sort() };
}

export function matchDomain(library: Library, topic: string): TopicMatch {
  return matchTopic([...library.domains.values()], topic);
}

/**
 * Resolve a learner's choice into an Expert.
 *
 * Refuses anything the Catalogue did not offer, including a plausible-looking id.
 * ADR 0007 made the learner choose because the platform has no way to know the
 * preference; a resolver that accepted an unoffered id would put the guessing back,
 * just somewhere less visible than a default.
 */
export function choose(library: Library, domainId: string, personaId: string, styleId: string): Expert {
  const offered = catalogue(library);
  const require = (options: EntryOption[], id: string, what: string): void => {
    if (!options.some((option) => option.id === id)) {
      throw new NotOffered(
        `\`${id}\` is not an offered ${what}. Offered: ${options.map((option) => option.id).join(", ")}`,
      );
    }
  };

  require(offered.domains, domainId, "Domain");
  require(offered.personas, personaId, "Persona");
  require(offered.styles, styleId, "Style");

  return composeExpert(library, personaId, styleId, domainId);
}
