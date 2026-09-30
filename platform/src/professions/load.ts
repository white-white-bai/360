import { readFileSync } from "node:fs";

import { PROFESSIONS_FILE } from "../catalog.ts";
import { matchTopic } from "../experts/catalogue.ts";
import { requireOneOf, requireString } from "../util/frontmatter.ts";
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
 * Status from signatures and risk, never from a field (ADR 0012):
 * high-risk is closed until two independent reviewers can sign — which
 * no Domain can do today, since each records exactly one reviewer.
 */
export function professionStatus(
  profession: Profession,
  signedDomainIds: ReadonlySet<string>,
): ProfessionStatus {
  if (profession.risk === "high") return "closed";
  return profession.domainIds.some((id) => signedDomainIds.has(id)) ? "open" : "planned";
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
}

const TIER_LABEL: Record<Tier, string> = {
  A: "知识可全教",
  B: "认知层，另注明不替代实操",
  C: "只教认知层",
};

export function professionOptions(
  index: ProfessionIndex,
  signedDomainIds: ReadonlySet<string>,
): ProfessionOption[] {
  const options: ProfessionOption[] = [];
  for (const profession of index.professions.values()) {
    const category = index.categories.get(profession.categoryId);
    const status = professionStatus(profession, signedDomainIds);
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
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, "zh"));
}

/**
 * The door rule for closed Professions (ADR 0012): a topic that resolves
 * to a high-risk Profession is refused at BOTH doors — the board's build
 * path and the direct classroom — before any model is called.
 *
 * Matching is containment on names and aliases, the same conservative rule
 * `matchTopic` uses everywhere else: a wrong refusal is annoying, but a
 * wrong unverified answer to "how do I dose this" is the product failure
 * this exists to prevent.
 */
export function highRiskRefusal(
  index: ProfessionIndex,
  topic: string,
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
  const risky = [...ids]
    .map((id) => index.professions.get(id))
    .filter((profession): profession is Profession => profession !== undefined && profession.risk === "high");
  if (risky.length === 0) return undefined;

  return (
    `「${risky.map((profession) => profession.name).join("、")}」是高风险行业：教错了会有后果。` +
    "在两名独立审核人签字之前，平台不开放这一行——直接课堂也一样。"
  );
}
