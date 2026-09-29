import { createHash } from "node:crypto";

/**
 * Fetching a candidate source (ADR 0010).
 *
 * The builder may not write corpus text, so it fetches. What comes back is treated as DATA:
 * the text is stored, hashed, and quoted from — never executed and never obeyed. The caps are
 * here because a "document" is allowed to be wrong, but it is not allowed to be unbounded.
 */
export interface FetchedDocument {
  /** What was asked for. */
  requested: string;
  /** Where the bytes actually came from, after redirects. What a reader should open. */
  url: string;
  fetchedAt: string;
  mediaType: string;
  /** Of the extracted text, so a re-fetch can be compared rather than trusted. */
  sha256: string;
  bytes: number;
  text: string;
}

export type Fetcher = (url: string) => Promise<FetchedDocument>;

/** A source that cannot be used, with the reason — never a silent skip. */
export class FetchRefused extends Error {}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const USER_AGENT = "agent-teaching-platform domain-builder";

/**
 * A page, reduced to the text a person would read.
 *
 * Not a browser and not trying to be: scripts and styles never reach the corpus, block-level
 * tags become line breaks, and the rest of the markup becomes spacing. Good enough to quote
 * from and honest about it — every quote is verified against THIS extraction, not against the
 * original HTML, so the check and the corpus use one representation.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Last, so that `&amp;lt;` decodes to the text `&lt;` and not to `<`.
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Injected in tests; the real fetcher uses the platform's `fetch`. */
  fetchImpl?: typeof fetch;
}

export function httpFetcher(options: FetchOptions = {}): Fetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  return async (requested: string): Promise<FetchedDocument> => {
    let parsed: URL;
    try {
      parsed = new URL(requested);
    } catch {
      throw new FetchRefused(`not a URL: ${JSON.stringify(requested)}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new FetchRefused(`refused a source that is not http(s): ${requested}`);
    }

    const response = await doFetch(requested, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new FetchRefused(`${requested} returned HTTP ${response.status}`);
    }

    const mediaType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!(mediaType.startsWith("text/") || mediaType === "application/xml" || mediaType === "application/json")) {
      throw new FetchRefused(`${requested} is ${mediaType || "of unknown type"}; the builder reads text`);
    }

    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new FetchRefused(`${requested} returned no body`);
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // Cancelled rather than read to the end: the cap is the point.
        await reader.cancel().catch(() => undefined);
        throw new FetchRefused(`${requested} is over the ${maxBytes}-byte cap`);
      }
      chunks.push(value);
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const text = mediaType === "text/html" || mediaType === "application/xhtml+xml" ? htmlToText(body) : body.trim();
    if (text === "") {
      throw new FetchRefused(`${requested} yielded no readable text`);
    }

    return {
      requested,
      url: response.url === "" ? requested : response.url,
      fetchedAt: new Date().toISOString(),
      mediaType,
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: size,
      text,
    };
  };
}
