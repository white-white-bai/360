import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDomain } from "../src/build/build-domain.ts";
import { parseDomainPlan } from "../src/build/contracts.ts";
import { htmlToText, httpFetcher, readLocalDocuments } from "../src/build/fetch.ts";
import {
  BUILD_LOCAL_PLAN,
  BUILD_SELECTION,
  DOC_A,
  DOC_B,
  SOURCE_A,
  SOURCE_B,
  builderScript,
  documentedFetcher,
} from "../src/build/fixtures-build.ts";
import { locateQuote, MIN_QUOTE_CHARS } from "../src/build/quotes.ts";
import { inspectDraft, signDraft } from "../src/build/review-domain.ts";
import { loadDomain } from "../src/experts/load.ts";
import { ScriptedProvider } from "../src/providers/scripted.ts";
import { validateDraft } from "../src/validate/rules.ts";

/**
 * ADR 0010's first cut: the builder writes a draft whose passages are all REAL quotations from
 * fetched documents; the kernel proves it; and nothing teaches until a person signs.
 *
 * The fixtures (see fixtures-build.ts) are a made-up micro-topic on purpose — the pipeline is
 * what is under test, and a made-up spec keeps the assertions about the MACHINERY rather than
 * about someone's standards document.
 *
 * ADR 0016 added the second entrance: the same pipeline over a directory of files the Owner
 * provided. The proof is the SAME code — a tampered quote still stops the build — so the tests
 * below assert exactly that, plus the one thing the entrance changes: where the bytes come from.
 */

function workspace(t: { after: (fn: () => void) => void }): { draftsDir: string; domainsDir: string } {
  const root = mkdtempSync(join(tmpdir(), "atp-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { draftsDir: join(root, "domains-draft"), domainsDir: join(root, "domains") };
}

/** A directory of files the Owner provided, named so sorted order is their sourceIndex order. */
function providedSources(t: { after: (fn: () => void) => void }, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "atp-provided-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, "utf8");
  return dir;
}

function run(dirs: { draftsDir: string; domainsDir: string }, overrides: Record<string, string | string[]> = {}) {
  return buildDomain({
    topic: "记号与长度",
    provider: new ScriptedProvider({ ...builderScript(), ...overrides }),
    fetcher: documentedFetcher(),
    ...dirs,
  });
}

function runProvided(
  dirs: { draftsDir: string; domainsDir: string },
  local: string,
  overrides: Record<string, string | string[]> = {},
) {
  return buildDomain({
    topic: "记号与长度",
    provider: new ScriptedProvider({ ...builderScript(), ...overrides }),
    // The fetcher throws if reached: the provided entrance must never touch the network.
    fetcher: async (url) => {
      throw new Error(`the provided entrance fetched ${url}, which it must not`);
    },
    local: { dir: local },
    ...dirs,
  });
}

// ------------------------------------------------------------ the kernel check --

test("a quote is found whitespace aside, and one word changed is not", () => {
  // The difference between selection and composition, made decidable.
  const folded = locateQuote(
    "A token is the smallest unit the format defines,\nand the length of a token counts its characters",
    DOC_A,
  );
  assert.equal(folded.found, true, "a line break is typography, not evidence");

  const changed = locateQuote(
    "A token is the smallest unit the format defines, and the length of a token counts its GRAPHEMES",
    DOC_A,
  );
  assert.equal(changed.found, false, "one changed word must stop being findable");
});

test("a quote under the evidence floor is not evidence, however well it matches", () => {
  assert.ok(MIN_QUOTE_CHARS > 0);
  const short = locateQuote("A token is", DOC_A);
  assert.equal(short.found, false, "a fragment that short occurs everywhere by accident");
});

test("a page becomes the text a person would read", () => {
  const html = [
    "<html><head><style>p { color: red }</style><script>steal()</script></head>",
    "<body><h1>Offsets</h1><p>The offset is a value.</p><!-- note -->",
    "<p>Not&nbsp;a&nbsp;zone &amp; not &lt;this&gt;.</p></body></html>",
  ].join("");
  const text = htmlToText(html);
  assert.ok(!text.includes("steal()"), "scripts never reach the corpus");
  assert.ok(!text.includes("color: red"), "nor styles");
  assert.match(text, /Offsets/);
  assert.match(text, /The offset is a value\./);
  assert.match(text, /Not a zone & not <this>\./, "entities decode, ampersand last");
});

test("the fetcher refuses what is not fetchable text", async () => {
  const routes = httpFetcher({
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/404")) return new Response("gone", { status: 404 });
      if (url.endsWith("/image")) return new Response("x", { headers: { "content-type": "image/png" } });
      return new Response("<p>hello</p>", { headers: { "content-type": "text/html" } });
    },
  });

  await assert.rejects(() => routes("file:///etc/passwd"), /not http\(s\)/);
  await assert.rejects(() => routes(`${SOURCE_A}/404`), /HTTP 404/);
  await assert.rejects(() => routes(`${SOURCE_A}/image`), /builder reads text/);

  const capped = httpFetcher({
    maxBytes: 20,
    fetchImpl: async () => new Response("x".repeat(200), { headers: { "content-type": "text/plain" } }),
  });
  await assert.rejects(() => capped(SOURCE_A), /cap/);
});

// ---------------------------------------------------------------- the pipeline --

test("a build writes a draft the validator accepts, one signature short", async (t) => {
  const dirs = workspace(t);
  const result = await run(dirs);

  assert.equal(
    result.unexpected.length,
    0,
    `a draft must be clean apart from the signature: ${JSON.stringify(result.unexpected, null, 2)}`,
  );
  assert.deepEqual(
    result.pending.map((finding) => finding.code).sort(),
    ["corpus.review-missing", "domain.owner-missing"],
    "the only expected findings are the two the signature fills",
  );

  const corpus = readFileSync(join(result.dir, "corpus.md"), "utf8");
  assert.ok(
    corpus.includes("counts its characters and not its UTF-8 bytes"),
    "the quote is in the corpus exactly as fetched",
  );
  const manifest = JSON.parse(readFileSync(join(result.dir, "sources.json"), "utf8")) as Array<{ url: string }>;
  assert.deepEqual(
    manifest.map((entry) => entry.url),
    [SOURCE_A, SOURCE_B],
    "both fetched sources are recorded for the review",
  );
});

test("a composed quote stops the whole build, and names itself", async (t) => {
  const dirs = workspace(t);
  const fabricated = JSON.stringify({
    passages: [
      {
        id: "P-token-def",
        sourceIndex: 0,
        citation: "§1",
        quote: "A token is the smallest unit the format defines, and the length of a token counts its GRAPHEMES and not its UTF-8 bytes.",
      },
    ],
  });

  await assert.rejects(() => run(dirs, { "passage-selector": fabricated }), /not in https:\/\/spec\.example\/alpha/);
});

test("a second build with the same plan refuses to overwrite the first draft", async (t) => {
  const dirs = workspace(t);
  await run(dirs);
  await assert.rejects(() => run(dirs), /already exists/);
});

// ------------------------------------------------------------------ the gate --

test("nothing teaches until a person signs, and the signature moves it", async (t) => {
  const dirs = workspace(t);
  const result = await run(dirs);

  const report = inspectDraft(result.id, { draftsDir: dirs.draftsDir });
  assert.equal(report.unexpected.length, 0);
  assert.equal(report.domain.corpus.passages.length, 2, "the reviewer sees what would be taught");

  const target = signDraft(result.id, { ...dirs, name: "白杨", date: "2026-09-29" });
  assert.equal(target, join(dirs.domainsDir, result.id));
  assert.equal(existsSync(join(dirs.draftsDir, result.id)), false, "the draft is gone, not copied");

  const signed = readFileSync(join(target, "meta.md"), "utf8");
  assert.match(signed, /^owner: 白杨$/m);
  assert.match(signed, /^corpusReviewedBy: 白杨$/m);
  assert.match(signed, /^corpusReviewedOn: 2026-09-29$/m);

  const domain = loadDomain(target);
  assert.equal(domain.owner, "白杨");
  assert.ok(domain.checks.length >= 1, "and the signed Domain loads as a Domain");
});

test("there is nothing to sign when there is no draft, or no name", async (t) => {
  const dirs = workspace(t);
  assert.throws(() => signDraft("never-built", { ...dirs, name: "白杨" }), /no draft/);

  const result = await run(dirs);
  assert.throws(() => signDraft(result.id, { ...dirs, name: "   " }), /needs a name/);
});

// ------------------------------------------------- the second entrance (ADR 0016) --

test("a plan with no sources is a plan at the provided entrance and an error at the URL one", () => {
  const plan = parseDomainPlan(BUILD_LOCAL_PLAN, "forbidden");
  assert.deepEqual(plan.sources, [], "the provided entrance's plan names no source");

  // The SAME text is refused by the URL entrance, which needs the plan to say what to fetch.
  assert.throws(() => parseDomainPlan(BUILD_LOCAL_PLAN), /at least one source/);
});

test("the provided entrance refuses a plan that names sources — the sources are in hand", () => {
  const withSources = JSON.stringify({
    id: "x",
    name: "x",
    boundary: "x",
    sources: [{ url: "https://spec.example/alpha", why: "…" }],
  });
  assert.throws(() => parseDomainPlan(withSources, "forbidden"), /build\.plan-from-conflict/);
});

test("provided files are read in sorted order, and non-text files are skipped with a reason", (t) => {
  const dir = providedSources(t, {
    "02-notes.txt": "the second file",
    "01-standard.md": "the first file",
    "scan.pdf": "%PDF-1.4 not text",
  });
  const { documents, skipped } = readLocalDocuments(dir);

  assert.deepEqual(
    documents.map((document) => document.url),
    ["local:01-standard.md", "local:02-notes.txt"],
    "sorted filename order, so sourceIndex is stable across runs",
  );
  assert.equal(skipped.length, 1);
  assert.match(skipped[0] ?? "", /scan\.pdf is not a text file/);
});

test("a provided build writes the same draft shape, with its sources recorded as local:", async (t) => {
  const dirs = workspace(t);
  const provided = providedSources(t, { "01-alpha.md": DOC_A, "02-beta.md": DOC_B });
  const result = await runProvided(dirs, provided, { "domain-planner": BUILD_LOCAL_PLAN });

  assert.equal(
    result.unexpected.length,
    0,
    `a provided draft is clean apart from the signature: ${JSON.stringify(result.unexpected, null, 2)}`,
  );
  assert.equal(result.documents.length, 2, "every provided document is used");

  const manifest = JSON.parse(readFileSync(join(result.dir, "sources.json"), "utf8")) as Array<{
    url: string;
    text: string;
  }>;
  assert.deepEqual(
    manifest.map((entry) => entry.url),
    ["local:01-alpha.md", "local:02-beta.md"],
    "the manifest records a provided source under the local: scheme",
  );
  for (const entry of manifest) {
    assert.ok(existsSync(join(result.dir, entry.text)), `${entry.text} was copied beside the draft`);
  }

  // It is an ordinary draft: the reviewer sees it, and signing moves it, exactly as for a fetch.
  const report = inspectDraft(result.id, { draftsDir: dirs.draftsDir });
  assert.equal(report.unexpected.length, 0);
  const target = signDraft(result.id, { ...dirs, name: "白杨", date: "2026-10-12" });
  assert.equal(loadDomain(target).corpus.passages.length, 2, "the signed Domain loads as a Domain");
});

test("a tampered provided quote still stops the build — the proof did not move", async (t) => {
  const dirs = workspace(t);
  const provided = providedSources(t, { "01-alpha.md": DOC_A, "02-beta.md": DOC_B });
  const fabricated = JSON.stringify({
    passages: [
      {
        id: "P-token-def",
        sourceIndex: 0,
        citation: "§1",
        quote:
          "A token is the smallest unit the format defines, and the length of a token counts its GRAPHEMES and not its UTF-8 bytes.",
      },
    ],
  });

  await assert.rejects(
    () => runProvided(dirs, provided, { "domain-planner": BUILD_LOCAL_PLAN, "passage-selector": fabricated }),
    /not in local:01-alpha\.md/,
  );
});

test("a provided source that changes on disk is a warning, and one that vanishes is an error", async (t) => {
  const dirs = workspace(t);
  const provided = providedSources(t, { "01-alpha.md": DOC_A, "02-beta.md": DOC_B });
  const result = await runProvided(dirs, provided, { "domain-planner": BUILD_LOCAL_PLAN });
  const before = validateDraft(result.dir).findings.filter(
    (finding) => finding.code === "corpus.source-changed" || finding.code === "corpus.source-unusable",
  );
  assert.equal(before.length, 0, "an untouched provided draft reports neither");

  // Drift: the file the quote traced to is not the file that is there now.
  const manifest = JSON.parse(readFileSync(join(result.dir, "sources.json"), "utf8")) as Array<{ text: string }>;
  const first = manifest[0]?.text;
  assert.ok(first !== undefined);
  writeFileSync(join(result.dir, first), `${DOC_A}\nAn added sentence the corpus was never quoted from.`, "utf8");
  const drifted = validateDraft(result.dir).findings;
  assert.ok(
    drifted.some((finding) => finding.code === "corpus.source-changed" && finding.severity === "warning"),
    "a changed file is a warning, not an error",
  );

  // Missing: a passage traced here was never backed by a document.
  const second = manifest[1]?.text;
  assert.ok(second !== undefined);
  rmSync(join(result.dir, second));
  const missing = validateDraft(result.dir).findings;
  assert.ok(
    missing.some((finding) => finding.code === "corpus.source-unusable" && finding.severity === "error"),
    "a missing file is an error, like a URL that names an error page",
  );
});
