import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

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

/**
 * A URL that cannot be a source, named before any bytes are read.
 *
 * A fetched "document" that is really an error page is worse than a failed
 * fetch: it enters `sources.json` as if it were authority, and the review
 * step has to notice the difference by eye. The fetcher refuses it here,
 * and the validator re-checks what is already on disk.
 */
const UNUSABLE_PATH = /unavailable|access-denied|accessdenied|blocked|captcha/i;

export function unusableSourceReason(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a URL";
  }
  return UNUSABLE_PATH.test(parsed.pathname)
    ? `the URL names an error page (${parsed.pathname}), not a document`
    : undefined;
}

// ----------------------------------------------------------- provided sources --

/**
 * The second entrance (ADR 0016): a document the Owner supplied rather than one the builder
 * fetched. Same `FetchedDocument` shape, same kernel check behind it — the only difference is
 * where the bytes came from, and a `local:` identifier is how that difference is recorded.
 */
export const LOCAL_SCHEME = "local:";

/** Is this source identifier one the Owner provided, rather than a URL? */
export function isLocalSource(identifier: string): boolean {
  return identifier.startsWith(LOCAL_SCHEME);
}

/**
 * The file name behind a provided-source identifier, or a reason the identifier cannot be one.
 *
 * Deliberately strict: exactly one path segment, no separators and no `..`. A provided source
 * names a file in the draft's own `sources/` directory, so anything that could point at a
 * different part of the disk is refused here rather than resolved.
 */
export function localFileName(identifier: string): { name: string } | { problem: string } {
  const name = identifier.startsWith(LOCAL_SCHEME) ? identifier.slice(LOCAL_SCHEME.length) : "";
  if (name === "") return { problem: `provided source ${JSON.stringify(identifier)} names no file` };
  if (name.includes("/") || name.includes("\\") || name.includes("..") || isAbsolute(name)) {
    return { problem: `provided source ${JSON.stringify(identifier)} is not a plain file name` };
  }
  return { name };
}

/** The one normalisation both entrances and the validator use, so a hash means one thing. */
export function normaliseProvidedText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

const PROVIDED_TEXT_MEDIA: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".rst": "text/plain",
};

function providedMediaType(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "text/plain" : PROVIDED_TEXT_MEDIA[name.slice(dot).toLowerCase()] ?? "text/plain";
}

function providedDocument(dir: string, name: string): FetchedDocument | { problem: string } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(dir, name));
  } catch (error) {
    return { problem: `could not be read: ${(error as Error).message}` };
  }
  const text = normaliseProvidedText(bytes.toString("utf8"));
  if (text === "") return { problem: "has no readable text" };
  return {
    requested: `${LOCAL_SCHEME}${name}`,
    url: `${LOCAL_SCHEME}${name}`,
    fetchedAt: "",
    mediaType: providedMediaType(name),
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: bytes.byteLength,
    text,
  };
}

/**
 * Every text file in `dir`, read as provided documents, in sorted file-name order.
 *
 * Sorted so the build is reproducible: the order the operating system hands back a directory is
 * not a fact about the corpus, and a `sourceIndex` that moved between two runs would make a
 * reviewer's notes about "document 2" mean something different the second time.
 *
 * Text files only. A PDF, scan or spreadsheet in the directory is SKIPPED with a reason rather
 * than read as mojibake — the Owner supplies text they have extracted, and the platform says so
 * instead of pretending the bytes were words.
 */
export function readLocalDocuments(dir: string): { documents: FetchedDocument[]; skipped: string[] } {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new FetchRefused(`no directory of provided sources at ${dir}`);
  }
  const skipped: string[] = [];
  const documents: FetchedDocument[] = [];
  const names = readdirSync(dir)
    .filter((name) => name !== "" && !name.startsWith("."))
    .sort();
  for (const name of names) {
    if (!statSync(join(dir, name)).isFile()) continue;
    const dot = name.lastIndexOf(".");
    if (dot < 0 || !(name.slice(dot).toLowerCase() in PROVIDED_TEXT_MEDIA)) {
      skipped.push(`${name} is not a text file (.md/.txt/.rst) — extract the text and put that in`);
      continue;
    }
    const document = providedDocument(dir, name);
    if ("problem" in document) {
      skipped.push(`${name} ${document.problem}`);
      continue;
    }
    documents.push(document);
  }
  if (documents.length === 0) {
    throw new FetchRefused(
      `no usable text files in ${dir}${skipped.length > 0 ? `:\n${skipped.map((s) => `  ${s}`).join("\n")}` : ""}`,
    );
  }
  return { documents, skipped };
}

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

    // A redirect that lands on an error page is a refused source, not a
    // document that happens to be short: the build fails here, where the
    // reason is the network's, rather than at review, where it would be
    // a person's job to notice. A Response built without a URL (tests,
    // some proxies) has nothing to check — the request URL was clean.
    if (response.url !== "") {
      const unusable = unusableSourceReason(response.url);
      if (unusable !== undefined) {
        throw new FetchRefused(`${requested} resolved to ${response.url}: ${unusable}`);
      }
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
