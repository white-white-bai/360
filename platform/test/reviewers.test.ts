import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { counterSignDomain } from "../src/build/review-domain.ts";
import { loadDomain } from "../src/experts/load.ts";
import { hasTwoReviewers } from "../src/experts/types.ts";
import { coverageLedger, signaturesOnDisk } from "../src/professions/coverage.ts";
import { highRiskRefusal, loadProfessions, professionStatus, type CompetencyIndex } from "../src/professions/load.ts";
import { validateDraft, validateRepo } from "../src/validate/rules.ts";

/**
 * The second signature (ADR 0017).
 *
 * A high-risk Profession used to be closed by a CONSTANT: `risk: high` meant no
 * content, forever. It is now closed by a computation — every listed Domain must
 * carry two reviewers with different names — so the tests that matter are the two
 * ends of it: one reviewer is still a closed door, two is an open one. The first
 * of those is the safety property, and it is pinned at the Domain, at the door,
 * and at the roster.
 *
 * The second thing pinned here is that the counter-signature is NOT a repair: a
 * Domain that does not pass the validator gets a refusal, exactly like a draft.
 */

const FIRST = "白杨";
const SECOND = "李四";
const TOPIC = "测试高危行业";

const NO_COMPETENCIES: CompetencyIndex = { competencies: new Map() };

/**
 * A catalogue with ONE high-risk profession that lists one Domain.
 *
 * The name and the alias are both here because the door resolves a topic either
 * way, and a door that opened on the name but not on the alias would be half open.
 */
function catalogue(reviewers: string[]): string {
  return [
    "---",
    "skeleton: test",
    "---",
    "",
    "## test-category",
    "kind: category",
    "name: 测试大类",
    "scope: 测试",
    "",
    "## test-risk",
    "kind: profession",
    "name: 测试高危行业",
    "category: test-category",
    "tier: B",
    "risk: high",
    "boundary: 教错了会直接伤人；两名独立审核人签字前不开放",
    "domains:",
    "  - test-domain",
    "aliases:",
    "  - 高危别名",
    "reviewers:",
    ...reviewers.map((name) => `  - ${name}`),
  ].join("\n");
}

interface Tree {
  root: string;
  domainsDir: string;
  professionsFile: string;
  domainDir: string;
}

function tmpTree(t: { after: (fn: () => void) => void }, reviewers: string[]): Tree {
  const root = mkdtempSync(join(tmpdir(), "atp-reviewers-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "personas"), { recursive: true });
  mkdirSync(join(root, "styles"), { recursive: true });
  const domainsDir = join(root, "domains");
  const domainDir = join(domainsDir, "test-domain");
  mkdirSync(domainDir, { recursive: true });
  writeDomain(domainDir, { owner: FIRST });
  const professionsFile = join(root, "professions.md");
  writeFileSync(professionsFile, catalogue(reviewers), "utf8");
  return { root, domainsDir, professionsFile, domainDir };
}

/**
 * A complete, valid, single-reviewed Domain directory.
 *
 * VALID is the point: `counterSignDomain` refuses a broken Domain, so a fixture
 * that merely loaded would make the refusal test below pass for the wrong reason.
 * The assertion in the first test keeps this honest.
 */
function writeDomain(dir: string, options: { owner: string; second?: string; secondOn?: string }): void {
  writeFileSync(
    join(dir, "meta.md"),
    [
      "---",
      "id: test-domain",
      "name: Test domain",
      `owner: ${options.owner}`,
      `corpusReviewedBy: ${options.owner}`,
      "corpusReviewedOn: 2026-01-01",
      ...(options.second !== undefined ? [`secondReviewedBy: ${options.second}`] : []),
      ...(options.secondOn !== undefined ? [`secondReviewedOn: ${options.secondOn}`] : []),
      "deliveryLanguage: zh",
      "sources:",
      "  - RFC 3339 — https://www.rfc-editor.org/rfc/rfc3339",
      "---",
      "",
      "这一行教什么，边界在哪。",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "corpus.md"),
    "## P-one\n\nsource: RFC 3339 §4.2 — https://www.rfc-editor.org/rfc/rfc3339#section-4.2\n\nAn offset is signed, and wall-clock readings are stated relative to UTC.\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "misconceptions.md"),
    "## M-one\n\nname: a thing\nwrongModel: they think x\nrefutation: it is y\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "checks.md"),
    "## C-one\n\nprompt: p\nexpected: e\ngrounding:\n  - P-one\ndiagnoses:\n  - wrong => M-one\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "glossary.md"),
    "---\nneverTranslate:\n  - UTC\n---\n\n## offset\nrendering: 偏移量\n\n## wall clock\nrendering: 本地墙上时间\n",
    "utf8",
  );
}

const readMeta = (dir: string): string => readFileSync(join(dir, "meta.md"), "utf8");
const codesOf = (dir: string): string[] => validateDraft(dir).findings.map((finding) => finding.code);

test("the fixture Domain passes the validator — otherwise every refusal below is about the wrong thing", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  const errors = validateDraft(tree.domainDir).findings.filter((finding) => finding.severity === "error");
  assert.deepEqual(errors.map((finding) => `${finding.code}: ${finding.message}`), []);
  assert.equal(hasTwoReviewers(loadDomain(tree.domainDir)), false, "one signature is not two");
});

// ---------------------------------------------------- the door, from closed to open

test("one signature is not two: a high-risk Profession stays closed and BOTH doors refuse", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  const index = loadProfessions(tree.professionsFile);
  const profession = index.professions.get("test-risk")!;
  const signatures = signaturesOnDisk(tree.domainsDir);

  assert.deepEqual([...signatures.signed], ["test-domain"], "the directory is the first signature");
  assert.deepEqual([...signatures.coSigned], [], "and nothing here is co-signed");
  assert.equal(professionStatus(profession, signatures.signed, signatures.coSigned), "closed");
  assert.equal(
    coverageLedger(index, NO_COMPETENCIES, signatures)[0]?.status,
    "closed",
    "the report and the page read the same computation (ADR 0015)",
  );

  // Both doors call this one function, with a topic a person would actually type.
  for (const topic of [TOPIC, "高危别名", "怎样进入测试高危行业"]) {
    assert.match(
      highRiskRefusal(index, topic, signatures) ?? "",
      /高风险行业/,
      `refused with only one reviewer: ${topic}`,
    );
  }
});

test("two different names open it — and the door opens for the name and the alias alike", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  counterSignDomain("test-domain", { name: SECOND, domainsDir: tree.domainsDir, date: "2026-02-02" });

  const index = loadProfessions(tree.professionsFile);
  const profession = index.professions.get("test-risk")!;
  const signatures = signaturesOnDisk(tree.domainsDir);

  assert.deepEqual([...signatures.coSigned], ["test-domain"]);
  assert.equal(professionStatus(profession, signatures.signed, signatures.coSigned), "open", "closed → open");
  assert.equal(coverageLedger(index, NO_COMPETENCIES, signatures)[0]?.status, "open");
  for (const topic of [TOPIC, "高危别名"]) {
    assert.equal(highRiskRefusal(index, topic, signatures), undefined, `walked through: ${topic}`);
  }
  // An ordinary topic was never the door's business, and still is not.
  assert.equal(highRiskRefusal(index, "时区到底是什么", signatures), undefined);
});

test("an empty roster of reviewers closes nothing on its own — the Domains are what open the line", (t) => {
  // `professionStatus` reads SIGNATURES, not the roster. The roster is a separate
  // rule (`profession.reviewers-insufficient`) enforced by the validator, so a
  // status that quietly depended on it would be a second opinion about which
  // lines are open — and the doors and the page could then disagree.
  const tree = tmpTree(t, []);
  counterSignDomain("test-domain", { name: SECOND, domainsDir: tree.domainsDir, date: "2026-02-02" });
  const profession = loadProfessions(tree.professionsFile).professions.get("test-risk")!;
  const signatures = signaturesOnDisk(tree.domainsDir);
  assert.equal(professionStatus(profession, signatures.signed, signatures.coSigned), "open");
});

test("one name written twice is one reviewer, not two", (t) => {
  // Independence is an attestation, but "two names" is the shape an attestation
  // has to have, and one name written twice does not have it. The loader must not
  // take a second LINE as a second PERSON — so the door stays shut even though
  // the file looks, to a careless grep, co-signed.
  const root = mkdtempSync(join(tmpdir(), "atp-review-twice-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "domains", "test-domain");
  mkdirSync(dir, { recursive: true });
  writeDomain(dir, { owner: FIRST, second: FIRST, secondOn: "2026-02-02" });

  assert.equal(hasTwoReviewers(loadDomain(dir)), false);
  assert.ok(codesOf(dir).includes("corpus.second-review-invalid"));
  assert.deepEqual([...signaturesOnDisk(join(root, "domains")).coSigned], [], "not co-signed");
});

test("an absent domains directory signs nothing — an unreadable shelf opens no door", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  const signatures = signaturesOnDisk(join(tree.root, "no-such-shelf"));
  assert.deepEqual([...signatures.signed], []);
  assert.deepEqual([...signatures.coSigned], []);
  const index = loadProfessions(tree.professionsFile);
  assert.match(highRiskRefusal(index, TOPIC, signatures) ?? "", /高风险行业/, "fails closed");
});

// -------------------------------------------------------------- the second signature

test("the counter-signature is written under the first one and never overwrites it", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  counterSignDomain("test-domain", { name: SECOND, domainsDir: tree.domainsDir, date: "2026-02-02" });

  const meta = readMeta(tree.domainDir);
  assert.match(meta, new RegExp(`^corpusReviewedBy: ${FIRST}$`, "m"), "the first signature is untouched");
  assert.match(meta, new RegExp(`^secondReviewedBy: ${SECOND}$`, "m"));
  assert.match(meta, /^secondReviewedOn: 2026-02-02$/m);
  assert.ok(hasTwoReviewers(loadDomain(tree.domainDir)), "and the loader sees two reviewers");
  assert.equal(codesOf(tree.domainDir).includes("corpus.second-review-invalid"), false);
});

test("the same person cannot sign twice, and a placeholder is not a person", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  assert.throws(
    () => counterSignDomain("test-domain", { name: FIRST, domainsDir: tree.domainsDir }),
    /different person/,
  );
  assert.throws(
    () => counterSignDomain("test-domain", { name: "TODO", domainsDir: tree.domainsDir }),
    /placeholder is not a reviewer/,
  );
  assert.throws(
    () => counterSignDomain("test-domain", { name: "   ", domainsDir: tree.domainsDir }),
    /needs a name/,
  );
  assert.equal(
    readMeta(tree.domainDir).includes("secondReviewedBy"),
    false,
    "a refused signature writes nothing at all",
  );
});

test("an already co-signed Domain is not re-signed behind the first reviewer's back", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  counterSignDomain("test-domain", { name: SECOND, domainsDir: tree.domainsDir, date: "2026-02-02" });
  assert.throws(
    () => counterSignDomain("test-domain", { name: "王五", domainsDir: tree.domainsDir }),
    /already carries a second reviewer/,
  );
  assert.match(readMeta(tree.domainDir), new RegExp(`^secondReviewedBy: ${SECOND}$`, "m"), "still 李四");
});

test("a broken Domain is refused a signature — a signature accepts material, it never repairs it", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  rmSync(join(tree.domainDir, "checks.md"));
  assert.ok(codesOf(tree.domainDir).length > 0, "the fixture is broken in a way the validator names");
  assert.throws(
    () => counterSignDomain("test-domain", { name: SECOND, domainsDir: tree.domainsDir }),
    /does not pass the validator/,
  );
  assert.equal(readMeta(tree.domainDir).includes("secondReviewedBy"), false);
});

test("counter-signing a Domain that is not there is a refusal, not a new directory", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  assert.throws(() => counterSignDomain("absent", { name: SECOND, domainsDir: tree.domainsDir }), /no Domain/);
});

// ------------------------------------------------------------------- the rules

test("a half-recorded, placeholder, or same-name second review is an error", (t) => {
  const cases: Array<{ label: string; options: Parameters<typeof writeDomain>[1] }> = [
    { label: "a name with no date", options: { owner: FIRST, second: SECOND } },
    { label: "a date with no name", options: { owner: FIRST, secondOn: "2026-02-02" } },
    { label: "a placeholder name", options: { owner: FIRST, second: "TODO", secondOn: "2026-02-02" } },
    { label: "a placeholder date", options: { owner: FIRST, second: SECOND, secondOn: "TBD" } },
    { label: "the same person twice", options: { owner: FIRST, second: FIRST, secondOn: "2026-02-02" } },
  ];
  for (const { label, options } of cases) {
    const dir = mkdtempSync(join(tmpdir(), "atp-review-half-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeDomain(dir, options);
    assert.ok(codesOf(dir).includes("corpus.second-review-invalid"), `error expected: ${label}`);
  }
});

test("no second-review lines at all is the honest single-reviewed state, not a finding", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  assert.equal(codesOf(tree.domainDir).includes("corpus.second-review-invalid"), false);
});

function repoCodes(tree: Tree): string[] {
  return validateRepo({
    personasDir: join(tree.root, "personas"),
    stylesDir: join(tree.root, "styles"),
    domainsDir: tree.domainsDir,
    professionsFile: tree.professionsFile,
  }).findings.map((finding) => finding.code);
}

test("a high-risk Profession that lists Domains must name two reviewers, and pass both gates", (t) => {
  // One reviewer named, one Domain listed, and the Domain is co-signed: the
  // ROLL is wrong even though the Domains are right. This is the half of ADR 0017
  // that is about people rather than files — the catalogue has to say who would
  // do the second read, not merely have had someone do it.
  const one = tmpTree(t, [FIRST]);
  counterSignDomain("test-domain", { name: SECOND, domainsDir: one.domainsDir, date: "2026-02-02" });
  const oneCodes = repoCodes(one);
  assert.ok(oneCodes.includes("profession.reviewers-insufficient"), `got: ${oneCodes.join(", ")}`);

  // Two names — and now the same tree is clean of the ADR 0017 rules entirely.
  const two = tmpTree(t, [FIRST, SECOND]);
  counterSignDomain("test-domain", { name: SECOND, domainsDir: two.domainsDir, date: "2026-02-02" });
  const twoCodes = repoCodes(two);
  assert.equal(twoCodes.includes("profession.reviewers-insufficient"), false, `got: ${twoCodes.join(", ")}`);
  assert.equal(twoCodes.includes("profession.high-risk-open"), false, `got: ${twoCodes.join(", ")}`);
});

test("a listed Domain with no second reviewer fails the high-risk gate by name", (t) => {
  const tree = tmpTree(t, [FIRST, SECOND]);
  // The roster is complete and the Profession names its reviewers — but nobody
  // has done the second read, so the line is still not open.
  const codes = repoCodes(tree);
  assert.ok(codes.includes("profession.high-risk-open"), `got: ${codes.join(", ")}`);
  assert.match(
    validateRepo({
      personasDir: join(tree.root, "personas"),
      stylesDir: join(tree.root, "styles"),
      domainsDir: tree.domainsDir,
      professionsFile: tree.professionsFile,
    }).findings.find((finding) => finding.code === "profession.high-risk-open")?.message ?? "",
    /test-domain/,
    "the finding names the Domain that is missing a reviewer",
  );
  assert.equal(codes.includes("profession.reviewers-insufficient"), false, "the roster is fine");
});
