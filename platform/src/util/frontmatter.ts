/**
 * Key/value parsing for the plain-text config assets (ADR 0006).
 *
 * Deliberately NOT a YAML implementation. It supports a small, documented
 * subset and rejects everything else LOUDLY. A silent mis-parse of a knowledge
 * asset is worse than a crash: ADR 0006 puts a validator between the assets and
 * the acceptance experiment precisely so that "the teaching design does not
 * work" and "the material was mis-configured" stay distinguishable — and a
 * parser that guesses would blur that line.
 *
 * Supported:
 *   key: scalar value
 *   key:
 *     - item
 *     - item
 * Rejected: nesting, anchors, multiline scalars, inline collections, duplicate
 * keys, tabs for indentation.
 */

export type Fields = Record<string, string | string[]>;

export interface Frontmatter {
  data: Fields;
  body: string;
}

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/;
const LIST_ITEM = /^[ \t]+-[ \t]+(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

const UNSUPPORTED =
  "supported forms are `key: value` and `key:` followed by indented `- item` lines";

/**
 * Parse a block of `key` / `list` lines. Shared by frontmatter and by asset
 * sections, so that a corpus passage, a misconception and a persona all obey
 * exactly the same grammar.
 */
export function parseKeyValueBlock(lines: readonly string[], where: string): Fields {
  const data: Fields = {};
  /** The key whose list is still open, if any. */
  let openListKey: string | null = null;
  /** The most recent key, so a stray item can name the key it probably meant. */
  let lastKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === "") continue;

    const keyMatch = !/^\s/.test(line) ? KEY.exec(line) : null;
    if (keyMatch) {
      const key = keyMatch[1] as string;
      const rawValue = keyMatch[2] ?? "";
      if (Object.hasOwn(data, key)) {
        throw new Error(`${where}: key \`${key}\` is declared twice`);
      }
      lastKey = key;
      if (rawValue.trim() === "") {
        data[key] = [];
        openListKey = key;
      } else {
        data[key] = unquote(rawValue);
        openListKey = null;
      }
      continue;
    }

    const itemMatch = LIST_ITEM.exec(line);
    if (itemMatch !== null && openListKey !== null) {
      (data[openListKey] as string[]).push(unquote(itemMatch[1] ?? ""));
      continue;
    }

    if (itemMatch !== null && lastKey !== null) {
      // Naming the key is the whole point. The bare "unsupported line" message
      // sent readers looking at the line they just wrote, when the mistake was
      // two lines earlier.
      throw new Error(
        `${where}: \`- item\` found after key \`${lastKey}\`, which already has a scalar value. ` +
          "A key is either `key: value` or `key:` followed by `- item` lines, never both.",
      );
    }

    throw new Error(`${where}: unsupported line ${JSON.stringify(line)} — ${UNSUPPORTED}`);
  }

  return data;
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("frontmatter must start on the first line with `---`");
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    throw new Error("frontmatter is unterminated (no closing `---`)");
  }
  return {
    data: parseKeyValueBlock(lines.slice(1, end), "frontmatter"),
    body: lines.slice(end + 1).join("\n"),
  };
}

export function requireString(data: Fields, key: string, where: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: required string key \`${key}\` is missing or empty`);
  }
  return value;
}

export function requireList(data: Fields, key: string, where: string): string[] {
  const value = data[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: required list key \`${key}\` is missing or empty`);
  }
  return value;
}

export function optionalString(data: Fields, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function optionalList(data: Fields, key: string): string[] {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

/** A closed set of allowed values, checked at load time. */
export function requireOneOf<T extends string>(
  data: Fields,
  key: string,
  allowed: readonly T[],
  where: string,
): T {
  const value = requireString(data, key, where);
  if (!allowed.includes(value as T)) {
    throw new Error(`${where}: \`${key}\` must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}
