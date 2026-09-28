import type { Assertion, AssertionKind, AssertionList } from "./types.ts";

const KINDS: ReadonlyArray<AssertionKind> = ["grounded", "scaffold"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, at: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${at} needs an array of passage ids`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`${at} source ${index} must be a non-empty string`);
    }
    return entry;
  });
}

/**
 * Parse the explainer's intended claims.
 *
 * A trust boundary: this is model output, so every field is checked rather than
 * assumed, and the vocabulary of `kind` is closed. The checks here are the ones
 * that are *decidable* — shape, uniqueness, and whether the two kinds are being
 * used consistently. Whether a claim actually follows from the passage it cites
 * is a judgement, and judgements belong to a separate actor (ADR 0004), not to
 * the parser and not to the explainer.
 */
export function parseAssertionList(text: string, domainId: string): AssertionList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`assertion list is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.assertions)) {
    throw new Error("assertion list must be an object with an `assertions` array");
  }
  if (parsed.assertions.length === 0) {
    throw new Error("assertion list is empty — a session with nothing to assert cannot teach");
  }

  const seen = new Set<string>();
  const assertions: Assertion[] = parsed.assertions.map((raw, index) => {
    const at = `assertion ${index}`;
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);

    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      throw new Error(`${at} needs a non-empty string \`id\``);
    }
    if (seen.has(raw.id)) throw new Error(`duplicate assertion id ${JSON.stringify(raw.id)}`);
    seen.add(raw.id);

    if (typeof raw.kind !== "string" || !KINDS.includes(raw.kind as AssertionKind)) {
      throw new Error(`${at} \`kind\` must be one of ${KINDS.join(", ")}, got ${JSON.stringify(raw.kind)}`);
    }
    const kind = raw.kind as AssertionKind;

    if (typeof raw.statement !== "string" || raw.statement.trim() === "") {
      throw new Error(`${at} needs a non-empty \`statement\``);
    }

    const sources = raw.sources === undefined ? [] : stringArray(raw.sources, at);
    if (kind === "grounded" && sources.length === 0) {
      throw new Error(
        `${at} is \`grounded\` but cites no passage — if nothing supports it, it is a scaffold`,
      );
    }
    if (kind === "scaffold" && sources.length > 0) {
      throw new Error(
        `${at} is \`scaffold\` but cites passages — a scaffold that cites sources is a grounded assertion wearing the wrong label`,
      );
    }

    return { id: raw.id, kind, statement: raw.statement, sources };
  });

  return { domainId, assertions };
}
