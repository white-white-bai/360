import type { Fields } from "./frontmatter.ts";
import { parseKeyValueBlock } from "./frontmatter.ts";

/**
 * Markdown split into `## <id>` sections, where each section carries an
 * optional key/value block plus free text.
 *
 * This is the one shape every knowledge asset uses — corpus passages,
 * misconceptions, glossary entries — so there is a single grammar to learn and
 * a single place for it to be wrong.
 */
export interface Section {
  id: string;
  fields: Fields;
  text: string;
}

const SECTION = /^##\s+(.+?)\s*$/;
const FIELD = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/;
const INDENTED_LIST_ITEM = /^[ \t]+-[ \t]+/;

export function parseSections(markdown: string, where: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  let id: string | null = null;
  let fieldLines: string[] = [];
  let textLines: string[] = [];

  const flush = (): void => {
    if (id === null) return;
    sections.push({
      id,
      fields: parseKeyValueBlock(fieldLines, `${where} section \`${id}\``),
      text: textLines.join("\n").trim(),
    });
    id = null;
    fieldLines = [];
    textLines = [];
  };

  for (const line of lines) {
    const section = SECTION.exec(line);
    if (section) {
      flush();
      id = (section[1] as string).trim();
      continue;
    }
    if (id === null) continue;

    if (!/^\s/.test(line) && FIELD.test(line)) {
      fieldLines.push(line);
      continue;
    }

    if (/^[ \t]/.test(line)) {
      // Only indented list items continue a field block. Anything else indented
      // is REFUSED rather than absorbed as text.
      //
      // This is not tidiness. A list item written without its `- ` marker used to
      // fall through into `text`, so a `diagnoses:` block could come out empty
      // while every parser succeeded — the misconception diagnosis silently
      // disconnected, with no error anywhere. That is precisely the silent
      // mis-parse this grammar exists to prevent, so an indented non-item is now
      // a hard failure with a message that names the likely mistake.
      if (INDENTED_LIST_ITEM.test(line) && fieldLines.length > 0) {
        fieldLines.push(line);
        continue;
      }
      throw new Error(
        `${where} section \`${id}\`: indented line ${JSON.stringify(line)} is not a \`- item\`. ` +
          "Indented list items must follow a `key:` line, and prose must start at column 0.",
      );
    }

    textLines.push(line);
  }
  flush();

  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) {
      throw new Error(`${where}: duplicate section \`${section.id}\``);
    }
    seen.add(section.id);
  }

  return sections;
}
