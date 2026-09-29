/**
 * The kernel's half of ADR 0010: a model may SELECT a passage from a fetched document, and it
 * may not COMPOSE one. The difference is decidable — the quote either occurs in the text that
 * was fetched, or it does not — so it is checked here, by code, before anything is written.
 *
 * Whitespace is the only thing folded away. Line breaks differ between a document and a model
 * reproducing it, and that is typography; a word changed is evidence. Anything looser (fuzzy
 * matching, ellipsis-joining) would stop noticing exactly the drift this check exists to catch.
 */

/** A quote shorter than this is not evidence of anything — it occurs everywhere by accident. */
export const MIN_QUOTE_CHARS = 40;

const fold = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface QuoteLocation {
  found: boolean;
  /** The normalized quote, for a message a person can act on. */
  needle: string;
}

/** Does `quote` occur in `document.text`, whitespace aside? */
export function locateQuote(quote: string, documentText: string): QuoteLocation {
  const needle = fold(quote);
  if (needle.length < MIN_QUOTE_CHARS) {
    return { found: false, needle };
  }
  return { found: fold(documentText).includes(needle), needle };
}
