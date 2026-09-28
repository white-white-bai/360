import { optionalList, requireString } from "../util/frontmatter.ts";
import { parseSections } from "../util/sections.ts";
import type { MisconceptionDiagnosis, UnderstandingCheck } from "./types.ts";

const DIAGNOSIS_SEPARATOR = "=>";

/**
 * Parse a diagnoses entry of the form `<phrase> => <misconception-id>`.
 *
 * A bespoke micro-syntax, because the shared key/value grammar is flat and a
 * diagnosis is inherently a pair. It is documented here and validated loudly so
 * a malformed entry cannot silently become "no diagnosis".
 */
function parseDiagnosis(item: string, where: string): MisconceptionDiagnosis {
  const parts = item.split(DIAGNOSIS_SEPARATOR);
  if (parts.length !== 2) {
    throw new Error(
      `${where}: diagnosis must be \`<phrase> ${DIAGNOSIS_SEPARATOR} <misconception-id>\`, got ${JSON.stringify(item)}`,
    );
  }
  const marker = (parts[0] as string).trim();
  const misconceptionId = (parts[1] as string).trim();
  if (marker === "" || misconceptionId === "") {
    throw new Error(`${where}: diagnosis has an empty phrase or id: ${JSON.stringify(item)}`);
  }
  return { marker, misconceptionId };
}

export function parseChecks(markdown: string, domainId: string): UnderstandingCheck[] {
  const where = `checks(${domainId})`;
  const checks = parseSections(markdown, where).map((section) => {
    const at = `${where} \`${section.id}\``;
    return {
      id: section.id,
      prompt: requireString(section.fields, "prompt", at),
      expected: requireString(section.fields, "expected", at),
      grounding: optionalList(section.fields, "grounding"),
      diagnoses: optionalList(section.fields, "diagnoses").map((item) => parseDiagnosis(item, at)),
    };
  });

  if (checks.length === 0) {
    throw new Error(`${where}: no checks found`);
  }
  return checks;
}

export function findCheck(checks: readonly UnderstandingCheck[], id: string): UnderstandingCheck {
  const found = checks.find((check) => check.id === id);
  if (found === undefined) {
    const known = checks.map((c) => c.id).join(", ") || "(none)";
    throw new Error(`unknown check \`${id}\`; known: ${known}`);
  }
  return found;
}
