import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  optionalList,
  parseFrontmatter,
  requireList,
  requireOneOf,
  requireString,
} from "../util/frontmatter.ts";
import { parseSections } from "../util/sections.ts";
import { parseCorpus } from "../grounding/corpus.ts";
import { parseChecks } from "../checks/load.ts";
import { DOMAINS_DIR, PERSONAS_DIR, STYLES_DIR } from "../catalog.ts";
import type { Domain, Expert, Misconception, Persona, Style } from "./types.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name))
    .sort();
}

export function loadPersona(path: string): Persona {
  const where = `persona(${path})`;
  const { data } = parseFrontmatter(read(path));
  return {
    id: requireString(data, "id", where),
    name: requireString(data, "name", where),
    stance: requireString(data, "stance", where),
    register: requireString(data, "register", where),
  };
}

const ANALOGY_DENSITY = ["low", "medium", "high"] as const;
const ORDER = ["conclusion-first", "motivation-first"] as const;
const ABSTRACTION = ["concrete", "balanced", "abstract"] as const;

export function loadStyle(path: string): Style {
  const where = `style(${path})`;
  const { data } = parseFrontmatter(read(path));
  return {
    id: requireString(data, "id", where),
    name: requireString(data, "name", where),
    analogyDensity: requireOneOf(data, "analogyDensity", ANALOGY_DENSITY, where),
    order: requireOneOf(data, "order", ORDER, where),
    abstraction: requireOneOf(data, "abstraction", ABSTRACTION, where),
    exampleType: requireString(data, "exampleType", where),
  };
}

export function parseMisconceptions(markdown: string, domainId: string): Misconception[] {
  const where = `misconceptions(${domainId})`;
  return parseSections(markdown, where).map((section) => ({
    id: section.id,
    name: requireString(section.fields, "name", `${where} \`${section.id}\``),
    wrongModel: requireString(section.fields, "wrongModel", `${where} \`${section.id}\``),
    refutation: requireString(section.fields, "refutation", `${where} \`${section.id}\``),
  }));
}

export function parseGlossary(markdown: string, domainId: string): Domain["glossary"] {
  const where = `glossary(${domainId})`;
  const { data, body } = parseFrontmatter(markdown);
  const terms: Record<string, string> = {};
  for (const section of parseSections(body, where)) {
    if (Object.hasOwn(terms, section.id)) {
      throw new Error(`${where}: duplicate term \`${section.id}\``);
    }
    terms[section.id] = requireString(section.fields, "rendering", `${where} term \`${section.id}\``);
  }
  return { terms, neverTranslate: optionalList(data, "neverTranslate") };
}

export function loadDomain(dir: string): Domain {
  const where = `domain(${dir})`;
  const { data } = parseFrontmatter(read(join(dir, "meta.md")));
  const id = requireString(data, "id", where);

  return {
    id,
    name: requireString(data, "name", where),
    owner: requireString(data, "owner", where),
    deliveryLanguage: requireString(data, "deliveryLanguage", where),
    sources: requireList(data, "sources", where),
    corpus: parseCorpus(read(join(dir, "corpus.md")), id),
    misconceptions: parseMisconceptions(read(join(dir, "misconceptions.md")), id),
    checks: parseChecks(read(join(dir, "checks.md")), id),
    glossary: parseGlossary(read(join(dir, "glossary.md")), id),
  };
}

export interface Library {
  personas: Map<string, Persona>;
  styles: Map<string, Style>;
  domains: Map<string, Domain>;
}

function indexById<T extends { id: string }>(items: T[], what: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`${what}: duplicate id \`${item.id}\``);
    map.set(item.id, item);
  }
  return map;
}

export function loadLibrary(
  personasDir: string = PERSONAS_DIR,
  stylesDir: string = STYLES_DIR,
  domainsDir: string = DOMAINS_DIR,
): Library {
  return {
    personas: indexById(markdownFiles(personasDir).map(loadPersona), "library(personas)"),
    styles: indexById(markdownFiles(stylesDir).map(loadStyle), "library(styles)"),
    domains: indexById(
      readdirSync(domainsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => loadDomain(join(domainsDir, entry.name))),
      "domains",
    ),
  };
}

function mustGet<T>(map: Map<string, T>, id: string, what: string): T {
  const found = map.get(id);
  if (found === undefined) {
    const known = [...map.keys()].sort().join(", ") || "(none)";
    throw new Error(`unknown ${what} \`${id}\`; known: ${known}`);
  }
  return found;
}

/** Compose the three axes. They are looked up separately on purpose (ADR 0006). */
export function composeExpert(library: Library, personaId: string, styleId: string, domainId: string): Expert {
  return {
    persona: mustGet(library.personas, personaId, "persona"),
    style: mustGet(library.styles, styleId, "style"),
    domain: mustGet(library.domains, domainId, "domain"),
  };
}
