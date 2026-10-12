import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadDomain } from "../src/experts/load.ts";
import type { Domain } from "../src/experts/types.ts";
import { loadProfessions } from "../src/professions/load.ts";
import {
  BASE_INTERVAL_DAYS,
  reviewAnchor,
  reviewDueOn,
  reviewIntervalDays,
  reviewLedger,
  reviewState,
  todayISO,
} from "../src/professions/review.ts";
import { validateDraft, validateRepo } from "../src/validate/rules.ts";

/**
 * The review lifecycle (ADR 0018) is tested the way its decisions are written:
 * each one gets a case that fails if that decision alone is reversed.
 *
 * The clock is never the subject. `today` arrives as an argument everywhere but
 * the edge, so every test below can say "in 2027 this is overdue" without
 * waiting, and a rule that reached for `Date.now()` would answer the same on
 * every date and be caught by exactly one of them.
 */

const CORPUS =
  "## P-one\n\nsource: RFC 3339 §4.2 — https://www.rfc-editor.org/rfc/rfc3339#section-4.2\n\n" +
  "An offset is signed, and wall-clock readings are stated relative to UTC.";
const MISCONCEPTIONS = "## M-one\n\nname: a thing\nwrongModel: they think x\nrefutation: it is y";
const CHECKS = "## C-one\n\nprompt: p\nexpected: e\ngrounding:\n  - P-one\ndiagnoses:\n  - wrong => M-one";
const GLOSSARY = "---\nneverTranslate:\n  - UTC\n---\n\n## offset\nrendering: 偏移量";

interface ReviewFields {
  id?: string;
  on?: string;
  by?: string;
  secondBy?: string;
  secondOn?: string;
}

function metaOf(fields: ReviewFields): string[] {
  const lines = [
    `id: ${fields.id ?? "d"}`,
    "name: Test domain",
    "owner: A Named Person",
    `corpusReviewedBy: ${fields.by ?? "A Named Person"}`,
    `corpusReviewedOn: ${fields.on ?? "2026-01-01"}`,
    "deliveryLanguage: zh",
    "sources:",
    "  - RFC 3339 — https://www.rfc-editor.org/rfc/rfc3339",
  ];
  if (fields.secondBy !== undefined) lines.push(`secondReviewedBy: ${fields.secondBy}`);
  if (fields.secondOn !== undefined) lines.push(`secondReviewedOn: ${fields.secondOn}`);
  return lines;
}

function professionSection(
  id: string,
  options: { tier?: string; risk?: string; domains?: string[] } = {},
): string {
  return [
    `## ${id}`,
    "kind: profession",
    `name: 职业 ${id}`,
    "category: test-category",
    `tier: ${options.tier ?? "A"}`,
    `risk: ${options.risk ?? "ordinary"}`,
    "boundary: 只用于测试",
    "domains:",
    ...(options.domains ?? []).map((domainId) => `  - ${domainId}`),
    "",
  ].join("\n");
}

const CATEGORY = "## test-category\nkind: category\nname: 测试大类\nscope: 测试\n";

/**
 * A whole shelf: a domain, a catalogue and a two-voice Library.
 *
 * The Library is two of each on purpose — the entry-choice rule (ADR 0007) makes
 * one voice a warning and none an error, and a test asserting `errors: 0` should
 * be measuring the review rule rather than somebody else's rule.
 */
function shelf(t: { after: (fn: () => void) => void }, fields: ReviewFields = {}): string {
  const root = mkdtempSync(join(tmpdir(), "atp-review-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const dir = join(root, "domains", fields.id ?? "d");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.md"), ["---", ...metaOf(fields), "---"].join("\n"), "utf8");
  writeFileSync(join(dir, "corpus.md"), CORPUS, "utf8");
  writeFileSync(join(dir, "misconceptions.md"), MISCONCEPTIONS, "utf8");
  writeFileSync(join(dir, "checks.md"), CHECKS, "utf8");
  writeFileSync(join(dir, "glossary.md"), GLOSSARY, "utf8");

  for (const id of ["a", "b"]) {
    mkdirSync(join(root, "personas"), { recursive: true });
    mkdirSync(join(root, "styles"), { recursive: true });
    writeFileSync(join(root, "personas", `${id}.md`), `---\nid: ${id}\nname: ${id}\nstance: s\nregister: r\n---\n`, "utf8");
    writeFileSync(
      join(root, "styles", `${id}.md`),
      ["---", `id: ${id}`, `name: ${id}`, "analogyDensity: low", "order: conclusion-first", "abstraction: concrete", "exampleType: e", "---"].join("\n"),
      "utf8",
    );
  }

  writeFileSync(join(root, "competencies.md"), "---\n---\n", "utf8");
  writeCatalogue(root, [professionSection("test-profession", { domains: [fields.id ?? "d"] })]);
  return root;
}

function writeCatalogue(root: string, sections: string[]): void {
  writeFileSync(
    join(root, "professions.md"),
    ["---", "skeleton: test", "---", "", CATEGORY, ...sections].join("\n"),
    "utf8",
  );
}

function domainIn(t: { after: (fn: () => void) => void }, fields: ReviewFields = {}): Domain {
  const root = shelf(t, fields);
  return loadDomain(join(root, "domains", fields.id ?? "d"));
}

function indexIn(
  t: { after: (fn: () => void) => void },
  sections: string[],
  fields: ReviewFields = {},
): { root: string; index: ReturnType<typeof loadProfessions> } {
  const root = shelf(t, fields);
  writeCatalogue(root, sections);
  return { root, index: loadProfessions(join(root, "professions.md")) };
}

function audit(root: string, today: string) {
  return validateRepo({
    personasDir: join(root, "personas"),
    stylesDir: join(root, "styles"),
    domainsDir: join(root, "domains"),
    professionsFile: join(root, "professions.md"),
    competenciesFile: join(root, "competencies.md"),
    today,
  });
}

test("the interval is two dials, and the shorter one wins", () => {
  // Tier answers "how much of this line can be taught here"; Risk answers "what
  // happens if the platform teaches it wrong". They are different questions, so
  // each gets its own number and the stricter one sets the pace.
  assert.equal(reviewIntervalDays("A", "ordinary"), 365);
  assert.equal(reviewIntervalDays("B", "ordinary"), 365);
  assert.equal(reviewIntervalDays("C", "ordinary"), 730);
  assert.equal(reviewIntervalDays("A", "high"), 90);
  assert.equal(reviewIntervalDays("B", "high"), 90);
  assert.equal(reviewIntervalDays("C", "high"), 90);
  // A high-risk C line is a paradox the dials resolve rather than a case the
  // table forgot: only the cognitive layer is taught, and a quarter is how long
  // that layer's sources stay trustworthy.
  assert.equal(
    BASE_INTERVAL_DAYS,
    reviewIntervalDays("A", "ordinary"),
    "the base rate is derived from the dials, so the two cannot drift apart",
  );
  assert.equal(BASE_INTERVAL_DAYS, 365);
});

test("a second signature is also a read, so the clock starts at the later date", (t) => {
  const single = domainIn(t, { on: "2024-03-01" });
  assert.equal(reviewAnchor(single), "2024-03-01", "one signature: the clock is that signature");

  const later = domainIn(t, { on: "2024-03-01", secondBy: "Someone Else", secondOn: "2026-05-02" });
  assert.equal(reviewAnchor(later), "2026-05-02", "a re-read in 2026 is not stale because 2024 signed it");

  // The max is taken from the dates, not from field order: an earlier second
  // signature cannot move the clock backwards and make a Domain look fresher
  // than its own later read.
  const earlier = domainIn(t, { on: "2026-05-02", secondBy: "Someone Else", secondOn: "2024-03-01" });
  assert.equal(reviewAnchor(earlier), "2026-05-02", "the clock goes forward only");
});

test("a second signature that is not one does not reset the clock", (t) => {
  // `hasTwoReviewers` (ADR 0017) is the same predicate the status computation
  // reads. Reusing it here is the point: a half-filled pair, a placeholder, or a
  // name repeated cannot buy time, and it cannot buy it in one place while being
  // refused in another.
  const halfPair = domainIn(t, { on: "2024-03-01", secondBy: "Someone Else" });
  assert.equal(reviewAnchor(halfPair), "2024-03-01", "a name with no date is not a read");

  const placeholderDate = domainIn(t, { on: "2024-03-01", secondBy: "Someone Else", secondOn: "TBD" });
  assert.equal(reviewAnchor(placeholderDate), "2024-03-01", "TBD is not a date it was read on");

  const sameName = domainIn(t, { on: "2024-03-01", secondBy: "A Named Person", secondOn: "2026-05-02" });
  assert.equal(reviewAnchor(sameName), "2024-03-01", "one person signing twice is still one read");
});

test("the strictest Profession listing a Domain sets its pace", (t) => {
  // A Domain can be taught under more than one line of work, and the lines can
  // disagree. The reader whose being wrong hurts is the one the platform answers
  // to, so the high-risk line sets the pace for everyone.
  const { root, index } = indexIn(
    t,
    [
      professionSection("ordinary-line", { tier: "A", risk: "ordinary", domains: ["d"] }),
      professionSection("hurting-line", { tier: "B", risk: "high", domains: ["d"] }),
    ],
    { on: "2026-01-01" },
  );
  const [entry] = reviewLedger(index, [loadDomain(join(root, "domains", "d"))], "2026-04-02");

  assert.equal(entry.intervalDays, 90);
  assert.equal(entry.pace?.id, "hurting-line");
  assert.equal(entry.dueOn, "2026-04-01");
  assert.equal(entry.overdue, true);
  assert.equal(entry.daysOverdue, 1);
});

test("a Domain no Profession lists runs at the base rate, and says so", (t) => {
  // The one place this policy does not fail closed, because there is nothing to
  // fail closed against: an unclaimed Domain has no consumer to hurt, and
  // `domain.unlisted` already names it as unclaimed.
  const { root, index } = indexIn(t, [professionSection("other-line", { domains: ["elsewhere"] })], { on: "2026-01-01" });
  const [entry] = reviewLedger(index, [loadDomain(join(root, "domains", "d"))], "2026-12-01");

  assert.equal(entry.intervalDays, BASE_INTERVAL_DAYS);
  assert.equal(entry.pace, undefined, "no Profession sets the pace, so none is named");
  assert.equal(entry.dueOn, "2027-01-01");
  assert.equal(entry.overdue, false);
});

test("due today is not overdue; the day after is overdue by one", (t) => {
  const domain = domainIn(t, { on: "2026-01-01" });
  assert.equal(reviewDueOn(domain, 90), "2026-04-01");

  assert.deepEqual(reviewState(domain, 90, "2026-03-31"), { dueOn: "2026-04-01", overdue: false, daysOverdue: 0 });
  // The due date is the last day the signature is good, not the first day it is
  // not — otherwise every Domain is a day stale for its whole last day.
  assert.deepEqual(reviewState(domain, 90, "2026-04-01"), { dueOn: "2026-04-01", overdue: false, daysOverdue: 0 });
  assert.deepEqual(reviewState(domain, 90, "2026-04-02"), { dueOn: "2026-04-01", overdue: true, daysOverdue: 1 });
  assert.deepEqual(reviewState(domain, 90, "2027-04-01"), { dueOn: "2026-04-01", overdue: true, daysOverdue: 365 });
});

test("a date that will not parse is not a date this rule can be wrong about", (t) => {
  // Saying "overdue" requires knowing when it came due, and saying "not overdue"
  // requires the same. When neither is knowable the honest output is neither, so
  // this reports nothing rather than inventing a number.
  const domain = domainIn(t, { on: "sometime in 2026" });
  assert.equal(reviewDueOn(domain, 365), undefined);
  assert.deepEqual(reviewState(domain, 365, "2030-01-01"), { overdue: false, daysOverdue: 0 });
});

test("`today` is an argument, so the same shelf answers differently on two dates", (t) => {
  // The whole reason the date is a parameter: a rule whose only test is "freeze
  // the system clock and hope" is tested once and never again.
  const { root, index } = indexIn(t, [professionSection("test-profession", { domains: ["d"] })], { on: "2026-01-01" });
  const domains = [loadDomain(join(root, "domains", "d"))];

  assert.equal(reviewLedger(index, domains, "2026-06-01")[0].overdue, false);
  assert.equal(reviewLedger(index, domains, "2027-06-01")[0].overdue, true);
  // And the real date, read at the edge only, is still a date.
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test("overdue is a warning, never an error, and it closes nothing", (t) => {
  const root = shelf(t, { on: "2026-01-01" });

  const fresh = audit(root, "2026-06-01");
  assert.equal(fresh.errors, 0, `unexpected errors: ${fresh.findings.map((f) => f.code).join(", ")}`);
  assert.ok(!fresh.findings.some((f) => f.code === "corpus.review-overdue"), "not due yet, so nothing to say");

  const stale = audit(root, "2027-06-01");
  const overdue = stale.findings.filter((f) => f.code === "corpus.review-overdue");
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].severity, "warning");
  // The load-bearing assertion: a validator that failed the build because nobody
  // had re-read a Domain since last spring would be switched off inside a week —
  // and would then stop reporting the errors it shares a run with.
  assert.equal(stale.errors, 0);
  assert.equal(stale.ok, true, "an overdue signature is an open question about an asset, not a defect in one");
  // 2026-01-01 + 365 days is 2027-01-01; read on 2027-06-01 that is 151 days late.
  assert.match(overdue[0].message, /due 2027-01-01 on a 365-day interval/);
  assert.match(overdue[0].message, /151 day\(s\) past review/);
});

test("the warning reads the ledger's own computation, pace included", (t) => {
  // Decision 6: the page, the report and the validator describe one asset one
  // way. The rule is handed the ledger's entry rather than recomputing it, so
  // the pace it names is the same pace `npm run coverage` prints.
  const { root, index } = indexIn(
    t,
    [
      professionSection("ordinary-line", { tier: "A", risk: "ordinary", domains: ["d"] }),
      professionSection("hurting-line", { tier: "B", risk: "high", domains: ["d"] }),
    ],
    { on: "2026-01-01" },
  );
  const [entry] = reviewLedger(index, [loadDomain(join(root, "domains", "d"))], "2027-06-01");
  assert.equal(entry.intervalDays, 90);

  const overdue = audit(root, "2027-06-01").findings.find((f) => f.code === "corpus.review-overdue");
  assert.ok(overdue !== undefined);
  assert.match(overdue.fix ?? "", /hurting-line/, "the strictest listing Profession is the one named");
  assert.match(overdue.message, /90-day interval/);
});

test("a draft has no Profession to set its pace, so it never goes overdue", (t) => {
  // An unsigned draft is work that has not been accepted; a clock on it would be
  // a deadline for something nobody has agreed to teach.
  const root = shelf(t, { on: "2020-01-01" });
  const report = validateDraft(join(root, "domains", "d"));
  assert.ok(!report.findings.some((f) => f.code === "corpus.review-overdue"));
});
