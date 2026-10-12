import { readFileSync } from "node:fs";

import { COMPETENCIES_FILE, PROFESSIONS_FILE } from "../catalog.ts";
import { matchTopic } from "../experts/catalogue.ts";
import { optionalString, requireOneOf, requireString } from "../util/frontmatter.ts";
import { parseFrontmatter, type Fields } from "../util/frontmatter.ts";
import { parseSections, type Section } from "../util/sections.ts";

/**
 * The industry catalogue (ADR 0012).
 *
 * One file, the section grammar every other knowledge asset uses, so a
 * Profession is as hard to mis-parse as a corpus passage. Status is
 * NOT stored here: it is computed from signatures, because a file that
 * says "we teach this" while no Domain is signed would be exactly the
 * dishonest Catalogue ADR 0002 forbids.
 */

/** How much of the industry can be taught (ADR 0012). */
export type Tier = "A" | "B" | "C";
/** What happens if the platform teaches it wrong. Independent of Tier. */
export type Risk = "ordinary" | "high";
/** Computed, never stored. */
export type ProfessionStatus = "open" | "planned" | "closed";

export interface Category {
  id: string;
  name: string;
  scope: string;
}

export interface Profession {
  id: string;
  name: string;
  categoryId: string;
  tier: Tier;
  risk: Risk;
  /** What the platform refuses to teach here — checkable, not remembered. */
  boundary: string;
  /** Signed Domains only. A draft is not coverage. */
  domainIds: string[];
  aliases: string[];
  /**
   * Who may review this line — the Owner's allocation, written down rather than
   * remembered (ADR 0017 decision 6), because the same key that signs also
   * decides who else may.
   *
   * Only one rule reads it: a high-risk Profession that lists Domains must name
   * at least TWO DISTINCT people (`profession.reviewers-insufficient`). An
   * ordinary Profession carries a roster too — the person who signs it — and no
   * rule constrains it, because there is nothing to constrain.
   */
  reviewers: string[];
}

export interface ProfessionIndex {
  categories: Map<string, Category>;
  professions: Map<string, Profession>;
}

const TIERS = ["A", "B", "C"] as const;
const RISKS = ["ordinary", "high"] as const;

function categoryOf(section: Section): Category {
  const where = `profession category \`${section.id}\``;
  return {
    id: section.id,
    name: requireString(section.fields, "name", where),
    scope: requireString(section.fields, "scope", where),
  };
}

function professionOf(section: Section): Profession {
  const where = `profession \`${section.id}\``;
  const data: Fields = section.fields;
  return {
    id: section.id,
    name: requireString(data, "name", where),
    categoryId: requireString(data, "category", where),
    tier: requireOneOf(data, "tier", TIERS, where),
    risk: requireOneOf(data, "risk", RISKS, where),
    boundary: requireString(data, "boundary", where),
    domainIds: (data.domains as string[] | undefined) ?? [],
    // A folk name is optional: not every profession has one.
    aliases: (data.aliases as string[] | undefined) ?? [],
    // Optional too — but for a high-risk line the validator requires two, so an
    // empty roster here is a finding rather than a silent absence.
    reviewers: (data.reviewers as string[] | undefined) ?? [],
  };
}

export function loadProfessions(file: string = PROFESSIONS_FILE): ProfessionIndex {
  const where = `professions(${file})`;
  const { body } = parseFrontmatter(readFileSync(file, "utf8"));
  const categories = new Map<string, Category>();
  const professions = new Map<string, Profession>();

  for (const section of parseSections(body, where)) {
    const kind = requireString(section.fields, "kind", `${where} \`${section.id}\``);
    if (kind === "category") {
      if (categories.has(section.id)) {
        throw new Error(`${where}: duplicate category \`${section.id}\``);
      }
      categories.set(section.id, categoryOf(section));
      continue;
    }
    if (kind === "profession") {
      if (professions.has(section.id)) {
        throw new Error(`${where}: duplicate profession \`${section.id}\``);
      }
      professions.set(section.id, professionOf(section));
      continue;
    }
    throw new Error(`${where}: \`${section.id}\` has unknown kind ${JSON.stringify(kind)}`);
  }

  if (categories.size === 0 || professions.size === 0) {
    throw new Error(`${where}: the catalogue needs at least one category and one profession`);
  }
  return { categories, professions };
}

/**
 * The Competency layer (ADR 0015): a must-know-and-be-able-to-apply unit of a
 * Profession, linked to the units that come before it.
 *
 * `boundary` and `beyond` are loaded as OPTIONAL. That is deliberate: a loader
 * that refuses a blank `beyond` would make `competency.missing-beyond`
 * unreachable dead code that reads like a safeguard — the same shape as
 * `profession.missing-boundary`. The rule has to be able to fire, so the
 * guarantee stays with the validator, where it is a finding, not a throw.
 */
export interface Competency {
  id: string;
  /** Whose unit this is. */
  professionId: string;
  name: string;
  /** What this platform will not claim here. */
  boundary: string;
  /** Signed Domains that teach it. A draft is not coverage. */
  domainIds: string[];
  /** The units that come before it — the order, stated rather than implied. */
  requires: string[];
  /** What is NOT taught here for this unit, and what kind of thing teaches it. */
  beyond: string[];
}

export interface CompetencyIndex {
  competencies: Map<string, Competency>;
}

/** Computed from signatures, exactly as a Profession's is. */
export type CompetencyStatus = "covered" | "planned";

function competencyOf(section: Section): Competency {
  const where = `competency \`${section.id}\``;
  const data: Fields = section.fields;
  return {
    id: section.id,
    professionId: requireString(data, "profession", where),
    name: requireString(data, "name", where),
    boundary: optionalString(data, "boundary") ?? "",
    domainIds: (data.domains as string[] | undefined) ?? [],
    requires: (data.requires as string[] | undefined) ?? [],
    beyond: (data.beyond as string[] | undefined) ?? [],
  };
}

export function loadCompetencies(file: string = COMPETENCIES_FILE): CompetencyIndex {
  const where = `competencies(${file})`;
  const { body } = parseFrontmatter(readFileSync(file, "utf8"));
  const competencies = new Map<string, Competency>();

  for (const section of parseSections(body, where)) {
    const kind = requireString(section.fields, "kind", `${where} \`${section.id}\``);
    if (kind !== "competency") {
      throw new Error(`${where}: \`${section.id}\` has unknown kind ${JSON.stringify(kind)}`);
    }
    if (competencies.has(section.id)) {
      throw new Error(`${where}: duplicate competency \`${section.id}\``);
    }
    competencies.set(section.id, competencyOf(section));
  }

  // An empty file is NOT an error: "no Profession has a map yet" is a truthful
  // state, and every Profession's empty half is displayed rather than hidden
  // (ADR 0014 decision 3). A MISSING file is a different thing — that throws.
  return { competencies };
}

/** Covered when a Domain that teaches it is signed. Never stored (ADR 0012/0015). */
export function competencyStatus(
  competency: Competency,
  signedDomainIds: ReadonlySet<string>,
): CompetencyStatus {
  return competency.domainIds.some((id) => signedDomainIds.has(id)) ? "covered" : "planned";
}

/** The units of one Profession, in declaration order. */
export function competenciesOf(index: CompetencyIndex, professionId: string): Competency[] {
  return [...index.competencies.values()].filter((unit) => unit.professionId === professionId);
}

/**
 * Prerequisites first: the learner reads a route, not a list (ADR 0014).
 *
 * Cycle-safe by construction rather than by assumption — the validator refuses
 * a cycle, but the board must still render one that no one has validated yet,
 * and a renderer that hangs is a worse failure than a map in the wrong order.
 * Anything left unplaced by the topological pass keeps declaration order.
 */
export function orderCompetencies(units: Competency[]): Competency[] {
  const known = new Set(units.map((unit) => unit.id));
  const placed = new Set<string>();
  const ordered: Competency[] = [];

  const visit = (unit: Competency): void => {
    if (placed.has(unit.id)) return;
    // Mark before recursing: a cycle then terminates instead of overflowing.
    placed.add(unit.id);
    for (const id of unit.requires) {
      if (!known.has(id)) continue;
      const prerequisite = units.find((candidate) => candidate.id === id);
      if (prerequisite !== undefined) visit(prerequisite);
    }
    ordered.push(unit);
  };

  for (const unit of units) visit(unit);
  return ordered;
}

const NO_DOMAINS: ReadonlySet<string> = new Set();

/**
 * The signature facts a status decision reads (ADR 0017).
 *
 * Two sets rather than one because they answer two different questions — "is
 * this Domain signed at all?" and "does it carry a second reviewer?" — and a
 * high-risk Profession needs both answers.
 *
 * In practice `coSigned` is a subset of `signed`: both are read off the same
 * scan of `domains/`, and a Domain carrying two reviewers carries one. The type
 * says nothing about that on purpose — the status rule is worth reading on its
 * own terms rather than as a consequence of how the callers happen to build it.
 */
export interface Signatures {
  signed: ReadonlySet<string>;
  coSigned: ReadonlySet<string>;
}

/** What a caller with no disk to read sees: every high-risk line closed. */
export const NO_SIGNATURES: Signatures = { signed: NO_DOMAINS, coSigned: NO_DOMAINS };

/**
 * Status from signatures and risk, never from a field (ADR 0012/0017):
 * high-risk is closed until EVERY Domain it lists carries a second reviewer.
 *
 * That is what makes `closed` mean "high-risk with no two-reviewer backing"
 * rather than "high risk, full stop" — the constant ADR 0012 decision 5 wrote
 * down because no Domain could hold a second name, and ADR 0017 replaced once
 * one could.
 *
 * EVERY, not any: a Profession listing three Domains where one is co-signed and
 * two are not is still teaching two unbacked slices of a subject where being
 * wrong hurts. And at least one must be signed, because a Domain that no one
 * has signed for teaches nothing at all — the ordinary rule, still enforced.
 *
 * The co-signed set defaults to empty, so a caller with no disk to read gets the
 * answer that was true before the second signature existed: closed.
 */
export function professionStatus(
  profession: Profession,
  signedDomainIds: ReadonlySet<string>,
  twoReviewerDomainIds: ReadonlySet<string> = NO_DOMAINS,
): ProfessionStatus {
  if (profession.risk === "high") {
    const backed =
      profession.domainIds.length > 0 &&
      profession.domainIds.every((id) => twoReviewerDomainIds.has(id)) &&
      profession.domainIds.some((id) => signedDomainIds.has(id));
    return backed ? "open" : "closed";
  }
  return profession.domainIds.some((id) => signedDomainIds.has(id)) ? "open" : "planned";
}

export interface CompetencyOption {
  id: string;
  name: string;
  status: CompetencyStatus;
  boundary: string;
  domainIds: string[];
  requires: string[];
  beyond: string[];
}

export interface ProfessionOption {
  id: string;
  label: string;
  detail: string;
  category: string;
  categoryLabel: string;
  tier: Tier;
  risk: Risk;
  status: ProfessionStatus;
  domainIds: string[];
  /** The map's first half, in prerequisite order (ADR 0015). */
  competencies: CompetencyOption[];
  /** The map's second half, stated once for the whole Profession. */
  capability: Capability;
}

const TIER_LABEL: Record<Tier, string> = {
  A: "知识可全教",
  B: "认知层，另注明不替代实操",
  C: "只教认知层",
};

/** The two halves of one Profession's map, in the shape the page draws. */
export interface Capability {
  /** Covered by a signed Domain, in prerequisite order. */
  covered: CompetencyOption[];
  /** Named, taught by nothing signed here yet. */
  planned: CompetencyOption[];
  /** What is not taught here, and what kind of thing teaches it. */
  beyond: Array<{ name: string; because: string[] }>;
}

/**
 * A `beyond` line answering "nothing here is beyond the cognitive layer".
 *
 * Kept as one recognisable prefix rather than parsed prose: the answer "無" is
 * a real answer (ADR 0015 decision 3), and a page that printed
 * 「不在这里教：X——无——这一单元完全落在认知层」 would read as noise. The
 * full text still travels in the same field, so nothing is hidden.
 */
const BEYOND_NOTHING = /^无([—\-，,。：:]\s*|$)|^無/;

/**
 * Whether a `beyond` line says there is nothing beyond the cognitive layer.
 *
 * Exported because the coverage ledger has to make the same judgement the page
 * does: if the page dropped these lines and the report counted them, the two
 * would describe the same asset differently, and a reader would have no way to
 * tell which one was lying (ADR 0015 decision 3).
 */
export function saysNothingBeyond(line: string): boolean {
  return BEYOND_NOTHING.test(line.trim());
}

function beyondOf(units: CompetencyOption[]): Array<{ name: string; because: string[] }> {
  return units
    .map((unit) => ({
      name: unit.name,
      because: unit.beyond.filter((line) => !saysNothingBeyond(line)),
    }))
    .filter((entry) => entry.because.length > 0);
}

function capabilityOf(units: CompetencyOption[]): Capability {
  return {
    covered: units.filter((unit) => unit.status === "covered"),
    planned: units.filter((unit) => unit.status === "planned"),
    beyond: beyondOf(units),
  };
}

function competencyOptionsOf(
  professionId: string,
  index: CompetencyIndex,
  signedDomainIds: ReadonlySet<string>,
): CompetencyOption[] {
  return orderCompetencies(competenciesOf(index, professionId)).map((unit) => ({
    id: unit.id,
    name: unit.name,
    status: competencyStatus(unit, signedDomainIds),
    boundary: unit.boundary,
    domainIds: unit.domainIds,
    requires: unit.requires,
    beyond: unit.beyond,
  }));
}

const NO_COMPETENCIES: CompetencyIndex = { competencies: new Map() };

export function professionOptions(
  index: ProfessionIndex,
  signatures: Signatures = NO_SIGNATURES,
  competencies: CompetencyIndex = NO_COMPETENCIES,
): ProfessionOption[] {
  const options: ProfessionOption[] = [];
  for (const profession of index.professions.values()) {
    const category = index.categories.get(profession.categoryId);
    const status = professionStatus(profession, signatures.signed, signatures.coSigned);
    const units = competencyOptionsOf(profession.id, competencies, signatures.signed);
    options.push({
      id: profession.id,
      label: profession.name,
      detail: `${TIER_LABEL[profession.tier]} · ${profession.boundary}`,
      category: profession.categoryId,
      categoryLabel: category?.name ?? profession.categoryId,
      tier: profession.tier,
      risk: profession.risk,
      status,
      domainIds: profession.domainIds,
      competencies: units,
      capability: capabilityOf(units),
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "zh"));
}

/**
 * The door rule for closed Professions (ADR 0012, re-cut by ADR 0017): a topic
 * that resolves to a CLOSED Profession is refused at BOTH doors — the board's
 * build path and the direct classroom — before any model is called.
 *
 * It reads the STATUS, not the risk. That is the whole of ADR 0017 decision 4:
 * once a line is backed by two reviewers it is open, and an open door is a door
 * by construction rather than by exemption. A high-risk line that is still
 * single-reviewed refuses with exactly the sentence it has always given, and the
 * default — no signatures at all — is every high-risk line still closed, which
 * is what a caller with no disk to read should see.
 *
 * Matching is containment on names and aliases, the same conservative rule
 * `matchTopic` uses everywhere else: a wrong refusal is annoying, but a
 * wrong unverified answer to "how do I dose this" is the product failure
 * this exists to prevent.
 */
export function highRiskRefusal(
  index: ProfessionIndex,
  topic: string,
  signatures: Signatures = NO_SIGNATURES,
): string | undefined {
  const entries: Array<{ id: string; name: string }> = [];
  for (const profession of index.professions.values()) {
    entries.push({ id: profession.id, name: profession.name });
    for (const alias of profession.aliases) {
      entries.push({ id: profession.id, name: alias });
    }
  }

  const match = matchTopic(entries, topic);
  if (match.kind === "none") return undefined;
  const ids = new Set(match.kind === "one" ? [match.id] : match.ids);
  const closed = [...ids]
    .map((id) => index.professions.get(id))
    .filter(
      (profession): profession is Profession =>
        profession !== undefined &&
        professionStatus(profession, signatures.signed, signatures.coSigned) === "closed",
    );
  if (closed.length === 0) return undefined;

  return (
    `「${closed.map((profession) => profession.name).join("、")}」是高风险行业：教错了会有后果。` +
    "在两名独立审核人签字之前，平台不开放这一行——直接课堂也一样。"
  );
}
