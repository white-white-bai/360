/**
 * The builder's model contracts (ADR 0010).
 *
 * Three actors speak these — the planner, the selector, the pedagogy author — and like every
 * other model output in this platform they are a trust boundary: parsed, shape-checked, and
 * refused loudly. What is NOT checked here is truth: a plan's sources are checked by fetching
 * them, and a passage's quote by the kernel (see quotes.ts). These parsers check the SHAPE,
 * because a shape error is the one failure that must never half-succeed.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
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

function oneLine(value: unknown, at: string): string {
  const text = nonEmptyString(value, at);
  if (text.includes("\n")) {
    throw new Error(`${at} must be a single line`);
  }
  return text;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function kebabId(value: unknown, at: string): string {
  const id = nonEmptyString(value, at);
  if (!KEBAB.test(id)) {
    throw new Error(`${at} must be lowercase kebab-case (letters, digits, dashes), got ${JSON.stringify(id)}`);
  }
  return id;
}

// ------------------------------------------------------------------ the plan --

export interface PlannedSource {
  url: string;
  why: string;
}

export interface DomainPlan {
  id: string;
  name: string;
  boundary: string;
  sources: PlannedSource[];
}

export function parseDomainPlan(text: string): DomainPlan {
  const parsed = parseJson(text, "domain plan");
  if (!isRecord(parsed)) throw new Error("domain plan must be an object");
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new Error("domain plan must list at least one source");
  }

  const sources = parsed.sources.map((raw, index) => {
    const at = `domain plan source ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const url = oneLine(raw.url, `${at} \`url\``);
    if (!/^https?:\/\//.test(url)) throw new Error(`${at} \`url\` must be http(s), got ${JSON.stringify(url)}`);
    return { url, why: oneLine(raw.why, `${at} \`why\``) };
  });

  return {
    id: kebabId(parsed.id, "domain plan `id`"),
    name: oneLine(parsed.name, "domain plan `name`"),
    boundary: oneLine(parsed.boundary, "domain plan `boundary`"),
    sources,
  };
}

// -------------------------------------------------------------- the selection --

export interface SelectedPassage {
  id: string;
  sourceIndex: number;
  citation: string;
  quote: string;
}

export function parseSelection(text: string): SelectedPassage[] {
  const parsed = parseJson(text, "passage selection");
  if (!isRecord(parsed) || !Array.isArray(parsed.passages)) {
    throw new Error("passage selection must be an object with a `passages` array");
  }
  if (parsed.passages.length === 0) {
    throw new Error("passage selection is empty — a corpus with no passages cannot teach");
  }

  const seen = new Set<string>();
  return parsed.passages.map((raw, index) => {
    const at = `passage ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const id = nonEmptyString(raw.id, `${at} \`id\``);
    if (seen.has(id)) throw new Error(`duplicate passage id ${JSON.stringify(id)}`);
    seen.add(id);
    if (typeof raw.sourceIndex !== "number" || !Number.isInteger(raw.sourceIndex) || raw.sourceIndex < 0) {
      throw new Error(`${at} \`sourceIndex\` must be a non-negative integer`);
    }
    return {
      id,
      sourceIndex: raw.sourceIndex,
      citation: oneLine(raw.citation, `${at} \`citation\``),
      quote: nonEmptyString(raw.quote, `${at} \`quote\``),
    };
  });
}

// --------------------------------------------------------------- the pedagogy --

export interface GlossaryTerm {
  term: string;
  rendering: string;
}

export interface DraftedMisconception {
  id: string;
  name: string;
  wrongModel: string;
  refutation: string;
}

export interface DraftedCheck {
  id: string;
  prompt: string;
  expected: string;
  grounding: string[];
  diagnoses: Array<{ phrase: string; misconceptionId: string }>;
}

export interface Pedagogy {
  glossary: { terms: GlossaryTerm[]; neverTranslate: string[] };
  misconceptions: DraftedMisconception[];
  checks: DraftedCheck[];
}

function stringList(value: unknown, at: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array of strings`);
  return value.map((item, index) => nonEmptyString(item, `${at} ${index}`));
}

export function parsePedagogy(text: string): Pedagogy {
  const parsed = parseJson(text, "pedagogy");
  if (!isRecord(parsed) || !isRecord(parsed.glossary)) {
    throw new Error("pedagogy must be an object with a `glossary` object");
  }
  if (!Array.isArray(parsed.misconceptions) || parsed.misconceptions.length === 0) {
    throw new Error("pedagogy must list at least one misconception");
  }
  if (!Array.isArray(parsed.checks) || parsed.checks.length === 0) {
    throw new Error("pedagogy must list at least one check");
  }

  const glossary = parsed.glossary;
  if (!Array.isArray(glossary.terms) || glossary.terms.length === 0) {
    throw new Error("pedagogy glossary must list at least one term");
  }
  const terms = glossary.terms.map((raw, index) => {
    const at = `glossary term ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    return {
      term: oneLine(raw.term, `${at} \`term\``),
      rendering: oneLine(raw.rendering, `${at} \`rendering\``),
    };
  });
  const neverTranslate = glossary.neverTranslate === undefined ? [] : stringList(glossary.neverTranslate, "glossary `neverTranslate`");

  const seenTerms = new Set<string>();
  for (const { term } of terms) {
    if (seenTerms.has(term)) throw new Error(`duplicate glossary term ${JSON.stringify(term)}`);
    seenTerms.add(term);
  }

  const seenMisconceptions = new Set<string>();
  const misconceptions = parsed.misconceptions.map((raw, index) => {
    const at = `misconception ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const id = nonEmptyString(raw.id, `${at} \`id\``);
    if (seenMisconceptions.has(id)) throw new Error(`duplicate misconception id ${JSON.stringify(id)}`);
    seenMisconceptions.add(id);
    return {
      id,
      name: oneLine(raw.name, `${at} \`name\``),
      // Single-line, because the section grammar carries fields as lines: a value with a line
      // break would silently become prose and the field would read as empty.
      wrongModel: oneLine(raw.wrongModel, `${at} \`wrongModel\``),
      refutation: oneLine(raw.refutation, `${at} \`refutation\``),
    };
  });

  const seenChecks = new Set<string>();
  const checks = parsed.checks.map((raw, index) => {
    const at = `check ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const id = nonEmptyString(raw.id, `${at} \`id\``);
    if (seenChecks.has(id)) throw new Error(`duplicate check id ${JSON.stringify(id)}`);
    seenChecks.add(id);
    if (!Array.isArray(raw.diagnoses) || raw.diagnoses.length === 0) {
      throw new Error(`${at} must list at least one diagnosis`);
    }
    const diagnoses = raw.diagnoses.map((entry, entryIndex) => {
      const where = `${at} diagnosis ${entryIndex}`;
      if (!isRecord(entry)) throw new Error(`${where} must be an object`);
      return {
        phrase: oneLine(entry.phrase, `${where} \`phrase\``),
        misconceptionId: nonEmptyString(entry.misconceptionId, `${where} \`misconceptionId\``),
      };
    });
    return {
      id,
      prompt: oneLine(raw.prompt, `${at} \`prompt\``),
      expected: oneLine(raw.expected, `${at} \`expected\``),
      grounding: stringList(raw.grounding, `${at} \`grounding\``),
      diagnoses,
    };
  });

  return { glossary: { terms, neverTranslate }, misconceptions, checks };
}
