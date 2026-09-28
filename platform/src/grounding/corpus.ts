import { requireString } from "../util/frontmatter.ts";
import { parseSections } from "../util/sections.ts";

/**
 * Corpus passages (ADR 0004).
 *
 * Every passage carries provenance a third party can check. That is the
 * physical meaning of `traceable`: not "the model says it read something", but
 * "this sentence came from this section of this document".
 *
 * Provenance is enforced at LOAD time. A missing source is not a warning — it
 * is refused, because a passage without provenance makes every assertion built
 * on it unverifiable, and unverifiable assertions are the exact failure the
 * grounding design exists to prevent.
 */
export interface CorpusPassage {
  id: string;
  source: string;
  text: string;
}

export interface Corpus {
  domainId: string;
  passages: CorpusPassage[];
}

/** Corpus text is written as a blockquote; the markers are presentation, not content. */
function stripQuoteMarkers(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

export function parseCorpus(markdown: string, domainId: string): Corpus {
  const where = `corpus(${domainId})`;
  const sections = parseSections(markdown, where);

  const passages: CorpusPassage[] = sections.map((section) => {
    const source = requireString(section.fields, "source", `${where} passage \`${section.id}\``);
    const text = stripQuoteMarkers(section.text);
    if (text === "") {
      throw new Error(`${where} passage \`${section.id}\` has no text`);
    }
    return { id: section.id, source, text };
  });

  if (passages.length === 0) {
    throw new Error(`${where}: no passages found (expected \`## <passage-id>\` sections)`);
  }

  return { domainId, passages };
}

export function findPassage(corpus: Corpus, id: string): CorpusPassage | undefined {
  return corpus.passages.find((passage) => passage.id === id);
}

/**
 * The passages an Assertion List is built from.
 *
 * Phase 1 takes the whole corpus, which is deliberately small enough for that
 * to be honest. Relevance-based selection arrives with the validator, so that
 * "the selection stayed inside the corpus" is checkable rather than assumed.
 */
export function excerpt(corpus: Corpus): CorpusPassage[] {
  return corpus.passages;
}
