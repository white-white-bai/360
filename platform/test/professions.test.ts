import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { httpFetcher, unusableSourceReason } from "../src/build/fetch.ts";
import { loadProfessions, highRiskRefusal, professionStatus } from "../src/professions/load.ts";
import { validateRepo } from "../src/validate/rules.ts";
import { createBoardServer } from "../src/ui/serve.ts";

/**
 * The industry catalogue (ADR 0012) is a promise with teeth:
 * status is computed from signatures, and a high-risk industry
 * is refused at BOTH doors before any model is called. These
 * tests hold all three.
 */

test("the shipped catalogue loads: every category, and the two high-risk industries", () => {
  const index = loadProfessions();
  assert.equal(index.categories.size, 8, "the official classification has eight categories");
  assert.ok(index.professions.size >= 10, "the pilot batch is seeded");
  const nurse = index.professions.get("nurse");
  const lawyer = index.professions.get("lawyer");
  assert.equal(nurse?.risk, "high");
  assert.equal(lawyer?.risk, "high");
  assert.deepEqual(nurse?.domainIds, [], "high-risk lists nothing — the door is closed");
});

test("status is computed, never stored: signed Domains open a profession", () => {
  const index = loadProfessions();
  const developer = index.professions.get("software-developer");
  const electrician = index.professions.get("electrician");
  const nurse = index.professions.get("nurse");
  assert.ok(developer !== undefined && electrician !== undefined && nurse !== undefined);

  const signed = new Set(["time-zones"]);
  assert.equal(professionStatus(developer, signed), "open", "one signed Domain is enough");
  assert.equal(professionStatus(electrician, signed), "planned", "no signed Domain, nothing to teach");
  assert.equal(professionStatus(nurse, signed), "closed", "high-risk is closed however many Domains exist");

  assert.equal(
    professionStatus(developer, new Set()),
    "planned",
    "an empty shelf is honest: planned, not open",
  );
});

test("a high-risk topic is refused, by name or by alias, and ordinary topics are not", () => {
  const index = loadProfessions();
  const refusal = highRiskRefusal(index, "护士怎么做心肺复苏");
  assert.match(refusal ?? "", /高风险行业/);
  assert.match(highRiskRefusal(index, "护理") ?? "", /高风险行业/, "an alias is the same door");
  assert.match(highRiskRefusal(index, "律师") ?? "", /高风险行业/);
  assert.equal(highRiskRefusal(index, "时区到底是什么"), undefined, "an ordinary topic walks through");
  assert.equal(highRiskRefusal(index, "怎样成为电工"), undefined, "a closed door is not the only door");
});

test("the fetcher names an error page instead of filing it as a source", () => {
  assert.match(unusableSourceReason("https://claude.com/app-unavailable-in-region") ?? "", /error page/);
  assert.equal(unusableSourceReason("https://example.com/docs/spec"), undefined);

  // A redirect's destination is the URL that matters, not the one
  // asked for. A hand-built Response stands in for the redirect.
  const redirected = {
    ok: true,
    url: "https://claude.com/app-unavailable-in-region",
    headers: new Headers({ "content-type": "text/html" }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<p>unavailable</p>"));
        controller.close();
      },
    }),
  } as unknown as Response;
  const fetcher = httpFetcher({ fetchImpl: async () => redirected });
  assert.rejects(() => fetcher("https://docs.example.com/overview"), /resolved to.*error page/);
});

test("the board refuses to build material for a closed industry", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-professions-"));
  const draftsDir = join(root, "domains-draft");
  const server = createBoardServer({ chunkDelayMs: 0, draftsDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const offered = (await (await fetch(`${base}/options`)).json()) as {
      professions: Array<{ id: string; status: string; categoryLabel: string }>;
    };
    assert.ok(offered.professions.length >= 10, "the page is offered the industry door");
    const nurse = offered.professions.find((profession) => profession.id === "nurse");
    assert.equal(nurse?.status, "closed");
    const developer = offered.professions.find((profession) => profession.id === "software-developer");
    assert.equal(developer?.status, "open", "signed Domains are what open it");
    assert.ok(developer?.categoryLabel.length > 0, "grouped by category name, not id");

    // A topic no Domain and no draft matches would be BUILT — and a
    // closed industry must not be built unattended.
    const build = await (await fetch(`${base}/board?topic=${encodeURIComponent("护士培训")}`)).text();
    assert.match(build, /event: failed/);
    assert.match(build, /高风险行业/);

    // The direct classroom is the other door, and it refuses before
    // any model is called — even with no provider configured.
    const classroom = await (
      await fetch(`${base}/classroom?topic=${encodeURIComponent("护士")}`)
    ).text();
    assert.match(classroom, /event: failed/);
    assert.match(classroom, /高风险行业/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a topic that is merely planned is not refused — it goes to the builder", async () => {
  const root = mkdtempSync(join(tmpdir(), "atp-professions-planned-"));
  const draftsDir = join(root, "domains-draft");
  const server = createBoardServer({ chunkDelayMs: 0, draftsDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 电工 is planned (no signed Domain) and ordinary risk: the board
    // must proceed to the build path, which fails later for want of a
    // provider — NOT with the closed-industry refusal.
    const build = await (await fetch(`${base}/board?topic=${encodeURIComponent("电工")}`)).text();
    assert.doesNotMatch(build, /高风险行业/);
    const classroom = await (
      await fetch(`${base}/classroom?topic=${encodeURIComponent("电工")}`)
    ).text();
    assert.doesNotMatch(classroom, /高风险行业/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken industry catalogue is a finding, and Domain rules still run", () => {
  // The catalogue and the Domains are checked independently: a
  // catalogue that will not parse must not silence the Domain
  // rules, which is what hiding them behind the catalogue's
  // success would do.
  const root = mkdtempSync(join(tmpdir(), "atp-professions-broken-"));
  const professionsFile = join(root, "professions.md");
  writeFileSync(professionsFile, "---\n---\n\n## broken\nkind: wizard\n", "utf8");
  for (const dir of ["personas", "styles", "domains", "domains/d"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(
    join(root, "domains", "d", "meta.md"),
    [
      "---",
      "id: d",
      "name: Test domain",
      "owner: TODO",
      "corpusReviewedBy: A Named Person",
      "corpusReviewedOn: 2026-01-01",
      "deliveryLanguage: zh",
      "sources:",
      "  - RFC 3339 — https://www.rfc-editor.org/rfc/rfc3339",
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(root, "domains", "d", "corpus.md"), "## P-one\n\nsource: RFC 3339 §4.2 — https://www.rfc-editor.org/rfc/rfc3339#section-4.2\n\nAn offset is signed, and wall-clock readings are stated relative to UTC.\n", "utf8");
  writeFileSync(join(root, "domains", "d", "misconceptions.md"), "## M-one\n\nname: a thing\nwrongModel: they think x\nrefutation: it is y\n", "utf8");
  writeFileSync(
    join(root, "domains", "d", "checks.md"),
    "## C-one\n\nprompt: p\nexpected: e\ngrounding:\n  - P-one\ndiagnoses:\n  - wrong => M-one\n",
    "utf8",
  );
  writeFileSync(
    join(root, "domains", "d", "glossary.md"),
    "---\nneverTranslate:\n  - UTC\n---\n\n## offset\nrendering: 偏移量\n\n## wall clock\nrendering: 本地墙上时间\n",
    "utf8",
  );

  const report = validateRepo({
    personasDir: join(root, "personas"),
    stylesDir: join(root, "styles"),
    domainsDir: join(root, "domains"),
    professionsFile,
  });
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "asset.unloadable" && finding.where.endsWith("professions.md"),
    ),
    `the broken catalogue is named: ${report.findings.map((f) => f.code).join(", ")}`,
  );
  assert.ok(
    report.findings.some((finding) => finding.code === "domain.owner-missing"),
    "the Domain rules ran even though the catalogue did not load",
  );
  rmSync(root, { recursive: true, force: true });
});
