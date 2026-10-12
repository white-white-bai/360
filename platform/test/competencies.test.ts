import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capabilityMap } from "../src/professions/coverage.ts";
import {
  competencyStatus,
  loadCompetencies,
  loadProfessions,
  orderCompetencies,
  professionStatus,
  saysNothingBeyond,
  type Competency,
} from "../src/professions/load.ts";
import { validateRepo } from "../src/validate/rules.ts";

/**
 * The Competency layer (ADR 0015) and its rules.
 *
 * Two properties are worth more than the rest of this file put together, and
 * both are about the layer being a ROUTE rather than a list: the order comes
 * from `requires` and not from the order someone happened to type the sections
 * in, and a map with no edges is reported even though every unit in it loads.
 * A layer that renders is not the same as a layer that says anything.
 */

const SIGNED = "signed-one";

function catalogue(domainIds: string[]): string {
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
    "## test-profession",
    "kind: profession",
    "name: 测试职业",
    "category: test-category",
    "tier: A",
    "risk: ordinary",
    "boundary: 只用于测试",
    "domains:",
    ...domainIds.map((id) => `  - ${id}`),
  ].join("\n");
}

/** One well-formed unit. Tests override exactly the field they are about. */
function unit(
  id: string,
  overrides: { profession?: string; boundary?: string; domains?: string[]; requires?: string[]; beyond?: string[] } = {},
): string {
  const domains = overrides.domains ?? [SIGNED];
  const requires = overrides.requires ?? [];
  const beyond = overrides.beyond ?? ["无——这一单元完全落在认知层"];
  return [
    `## ${id}`,
    "kind: competency",
    `profession: ${overrides.profession ?? "test-profession"}`,
    `name: 单元-${id}`,
    `boundary: ${overrides.boundary ?? "只用于测试"}`,
    "domains:",
    ...domains.map((domain) => `  - ${domain}`),
    "requires:",
    ...requires.map((id) => `  - ${id}`),
    "beyond:",
    ...beyond.map((line) => `  - ${line}`),
  ].join("\n");
}

interface Tree {
  root: string;
  professionsFile: string;
  competenciesFile: string;
}

function tmpTree(
  t: { after: (fn: () => void) => void },
  files: { professions?: string; competencies?: string; domains?: string[] } = {},
): Tree {
  const root = mkdtempSync(join(tmpdir(), "atp-competency-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "personas"), { recursive: true });
  mkdirSync(join(root, "styles"), { recursive: true });
  mkdirSync(join(root, "domains"), { recursive: true });
  // A directory under `domains/` IS a signature — drafts live elsewhere
  // (ADR 0010) — so "make this Domain signed" is exactly "make this directory".
  for (const id of files.domains ?? []) mkdirSync(join(root, "domains", id), { recursive: true });
  const professionsFile = join(root, "professions.md");
  const competenciesFile = join(root, "competencies.md");
  writeFileSync(professionsFile, files.professions ?? catalogue([]), "utf8");
  // The Competency asset is a frontmattered document like every other, so the
  // fixtures below are bare sections and the header is added once, here.
  writeFileSync(competenciesFile, `---\n---\n\n${files.competencies ?? ""}`, "utf8");
  return { root, professionsFile, competenciesFile };
}

function codes(tree: Tree): string[] {
  return validateRepo({
    personasDir: join(tree.root, "personas"),
    stylesDir: join(tree.root, "styles"),
    domainsDir: join(tree.root, "domains"),
    professionsFile: tree.professionsFile,
    competenciesFile: tree.competenciesFile,
  }).findings.map((finding) => finding.code);
}

// ------------------------------------------------------------------- the loader

test("a missing Competency file is an error; an empty one is a state", (t) => {
  // "No Profession has a map yet" is a truthful thing for this asset to say,
  // and every Profession's empty half is DISPLAYED rather than hidden (ADR 0014
  // decision 3). A missing file is a different claim — that nothing here has
  // ever been considered — so it throws and surfaces as `asset.unloadable`.
  const tree = tmpTree(t);
  assert.deepEqual([...loadCompetencies(tree.competenciesFile).competencies.keys()], []);
  assert.throws(() => loadCompetencies(join(tree.root, "absent.md")), /ENOENT/);
});

test("a duplicate unit id and an unknown kind both refuse to load", (t) => {
  // The loader's strictness is what makes the validator's findings mean
  // something: a file that silently kept the last `## unit-a` would report a
  // map that is not the map on disk.
  const duplicate = tmpTree(t, { competencies: [unit("unit-a"), "", unit("unit-a")].join("\n") });
  // The section grammar refuses the repeat before the loader's own guard can
  // see it, so the message names the section rather than the competency. Both
  // are the same refusal to load; asserting either lets that guard move.
  assert.throws(() => loadCompetencies(duplicate.competenciesFile), /duplicate (section|competency) `unit-a`/);

  const unknown = tmpTree(t, {
    competencies: "## unit-a\nkind: not-a-competency\nprofession: test-profession\n",
  });
  assert.throws(() => loadCompetencies(unknown.competenciesFile), /unknown kind/);
});

test("a blank boundary and a blank beyond LOAD — the validator is what refuses them", (t) => {
  // Deliberate, and the reason `competency.missing-boundary` is not dead code.
  // A loader that threw would move the guarantee out of the validator and into
  // a stack trace, where the reader gets one finding instead of a list.
  const tree = tmpTree(t, { competencies: unit("unit-a", { boundary: "", beyond: [] }) });
  const loaded = loadCompetencies(tree.competenciesFile);
  assert.equal(loaded.competencies.get("unit-a")?.boundary, "");
  assert.deepEqual(loaded.competencies.get("unit-a")?.beyond, []);
});

// ------------------------------------------------------------------- the status

test("covered is computed from signatures, never stored (ADR 0012's rule, one layer down)", (t) => {
  const tree = tmpTree(t, {
    domains: [SIGNED],
    competencies: [unit("unit-a"), "", unit("unit-b", { domains: ["not-signed"] }), "", unit("unit-c", { domains: [] })].join(
      "\n",
    ),
  });
  const index = loadCompetencies(tree.competenciesFile);
  const signed = new Set([SIGNED]);
  assert.equal(competencyStatus(index.competencies.get("unit-a")!, signed), "covered");
  assert.equal(competencyStatus(index.competencies.get("unit-b")!, signed), "planned");
  // A unit naming no Domain at all can never become covered by signing one —
  // it is not waiting on a signature, it is missing a claim.
  assert.equal(competencyStatus(index.competencies.get("unit-c")!, signed), "planned");
});

test("a Profession opens on the Domain's signature, never on the unit naming it", (t) => {
  // The acceptance path the layer is judged by: a Profession with a written unit
  // moves 待建 → 可学. What moves it is the SIGNATURE (ADR 0012's rule, ADR 0015
  // decision 2) — so the first tree below is a Profession with a unit and no
  // Domain, and it is still `planned`. A Competency layer that could open a
  // Profession would be a second door, and there is only one.
  const written = unit("accounting-basics", { domains: ["accounting-standards"] });
  const before = tmpTree(t, { professions: catalogue(["accounting-standards"]), competencies: written });
  const beforeProfession = loadProfessions(before.professionsFile).professions.get("test-profession")!;
  const beforeUnits = loadCompetencies(before.competenciesFile);
  assert.equal(professionStatus(beforeProfession, new Set()), "planned");
  assert.equal(competencyStatus(beforeUnits.competencies.get("accounting-basics")!, new Set()), "planned");

  // The same two assets, plus the Domain on disk — that directory IS the
  // signature — and both halves flip together.
  const after = tmpTree(t, {
    professions: catalogue(["accounting-standards"]),
    domains: ["accounting-standards"],
    competencies: written,
  });
  const signed = new Set(["accounting-standards"]);
  const afterProfession = loadProfessions(after.professionsFile).professions.get("test-profession")!;
  const afterUnits = loadCompetencies(after.competenciesFile);
  assert.equal(professionStatus(afterProfession, signed), "open");
  assert.equal(competencyStatus(afterUnits.competencies.get("accounting-basics")!, signed), "covered");
});

// -------------------------------------------------------------------- the order

test("a route reads prerequisites first, whatever order the file declares them in", (t) => {
  const tree = tmpTree(t, {
    // Deliberately backwards: the third rung is written first.
    competencies: [
      unit("step-3", { requires: ["step-2"] }),
      "",
      unit("step-2", { requires: ["step-1"] }),
      "",
      unit("step-1"),
    ].join("\n"),
  });
  const index = loadCompetencies(tree.competenciesFile);
  const units = [...index.competencies.values()];
  assert.deepEqual(
    orderCompetencies(units).map((unit) => unit.id),
    ["step-1", "step-2", "step-3"],
  );
});

test("a cycle is survivable: the board can still render a map no one has validated", (t) => {
  // The validator refuses a cycle, but the board draws whatever is on disk, and
  // a renderer that hangs is a worse failure than a map in a silly order. The
  // property that matters is that nothing is lost and nothing repeats.
  const tree = tmpTree(t, {
    competencies: [
      unit("unit-a", { requires: ["unit-b"] }),
      "",
      unit("unit-b", { requires: ["unit-a"] }),
      "",
      unit("unit-c", { requires: ["ghost"] }),
    ].join("\n"),
  });
  const index = loadCompetencies(tree.competenciesFile);
  const ordered = orderCompetencies([...index.competencies.values()]);
  assert.deepEqual(ordered.map((unit) => unit.id).sort(), ["unit-a", "unit-b", "unit-c"]);
});

// --------------------------------------------------------------- the validator

test("a unit belonging to no Profession in the catalogue is an error", (t) => {
  const tree = tmpTree(t, { competencies: unit("unit-a", { profession: "ghost-profession" }) });
  assert.ok(codes(tree).includes("competency.unknown-profession"), `got: ${codes(tree).join(", ")}`);
});

test("a unit taught by a Domain that is not signed is an error", (t) => {
  // The same rule as `profession.unknown-domain`, one layer down, for the same
  // reason: coverage is a signature, and a draft is not coverage.
  const tree = tmpTree(t, { competencies: unit("unit-a", { domains: ["still-a-draft"] }) });
  assert.ok(codes(tree).includes("competency.unknown-domain"));
});

test("a prerequisite naming a unit that does not exist is an error", (t) => {
  const tree = tmpTree(t, { competencies: unit("unit-a", { requires: ["missing-rung"] }) });
  assert.ok(codes(tree).includes("competency.unknown-prerequisite"));
});

test("a unit with no boundary is refused — it is a Profession's honesty, one layer down", (t) => {
  const tree = tmpTree(t, { competencies: unit("unit-a", { boundary: "  " }) });
  assert.ok(codes(tree).includes("competency.missing-boundary"));
});

test("a unit with no `beyond` is refused, and 「无」 is a real answer to it", (t) => {
  const missing = tmpTree(t, { competencies: unit("unit-a", { beyond: [] }) });
  assert.ok(codes(missing).includes("competency.missing-beyond"));

  // The field exists to force the statement, not to force a gap. A unit that is
  // entirely teachable says so; the page then prints nothing for it rather than
  // printing 「无」 at the learner.
  const answered = tmpTree(t, { competencies: unit("unit-a") });
  assert.ok(!codes(answered).includes("competency.missing-beyond"));
  assert.ok(saysNothingBeyond("无——这一单元完全落在认知层"));
  assert.ok(saysNothingBeyond("无"));
  assert.ok(!saysNothingBeyond("生产级部署不在本平台教"));
});

test("a prerequisite cycle is an error that NAMES the loop", (t) => {
  // "There is a cycle somewhere in forty units" is a message no one can act on.
  const tree = tmpTree(t, {
    competencies: [unit("unit-a", { requires: ["unit-b"] }), "", unit("unit-b", { requires: ["unit-a"] })].join("\n"),
  });
  const report = validateRepo({
    personasDir: join(tree.root, "personas"),
    stylesDir: join(tree.root, "styles"),
    domainsDir: join(tree.root, "domains"),
    professionsFile: tree.professionsFile,
    competenciesFile: tree.competenciesFile,
  });
  const cycle = report.findings.find((finding) => finding.code === "competency.cycle");
  assert.ok(cycle, `got: ${report.findings.map((f) => f.code).join(", ")}`);
  assert.match(cycle?.message ?? "", /unit-a → unit-b → unit-a/);
});

test("a map with no edges at all is a warning — a list is not a route", (t) => {
  // Note what this rule does NOT fire on: a unit nobody requires. Every route's
  // last step is unreferenced, so a rule that flagged that would flag correct
  // material and get switched off. The defect is a map with NO edges.
  const flat = tmpTree(t, { competencies: [unit("unit-a"), "", unit("unit-b")].join("\n") });
  assert.ok(codes(flat).includes("competency.orphan"), `got: ${codes(flat).join(", ")}`);

  // One edge anywhere is enough: `step-2` requires `step-1`, so the frontier
  // leaves `step-2` unreferenced and the rule stays quiet about it.
  const rooted = tmpTree(t, {
    competencies: [unit("step-1"), "", unit("step-2", { requires: ["step-1"] })].join("\n"),
  });
  assert.ok(!codes(rooted).includes("competency.orphan"), `got: ${codes(rooted).join(", ")}`);
});

test("a Profession with a signed Domain and no map is a warning — and only when it is open", (t) => {
  // ADR 0014 decision 3: the empty half of the map is displayed, not hidden, so
  // an open Profession with nothing to show is a real gap. A `planned`
  // Profession with no map is the ordinary state of a catalogue that is honest
  // about its length (ADR 0002), and warning about that would be warning about
  // how long the file is.
  const open = tmpTree(t, { professions: catalogue([SIGNED]), domains: [SIGNED] });
  assert.ok(codes(open).includes("profession.no-competency"), `got: ${codes(open).join(", ")}`);

  const planned = tmpTree(t, { professions: catalogue([]) });
  assert.ok(!codes(planned).includes("profession.no-competency"), `got: ${codes(planned).join(", ")}`);
});

test("a well-formed map raises none of the Competency rules", (t) => {
  // The rules exist to fire for their own reasons and stay quiet otherwise;
  // asserting only that something fired would pass for any defect anywhere.
  const tree = tmpTree(t, {
    professions: catalogue([SIGNED]),
    domains: [SIGNED],
    competencies: [
      unit("step-1"),
      "",
      unit("step-2", { requires: ["step-1"] }),
      "",
      unit("step-3", { requires: ["step-2"], domains: [], beyond: ["生产级部署不在本平台教——由真实上线环境来教"] }),
    ].join("\n"),
  });
  const found = codes(tree);
  const noise = found.filter((code) => code.startsWith("competency.") || code === "profession.no-competency");
  assert.deepEqual(noise, [], `unexpected competency findings: ${noise.join(", ")}`);
});

// ------------------------------------------------------------- the ledger's map

test("the ledger's map splits both halves, and never prints 「无」 as a gap", (t) => {
  // The page and the report run the same judgement here; if only one of them
  // filtered these lines they would describe one asset two ways, and a reader
  // would have no way to tell which was lying (ADR 0015 decision 3).
  const tree = tmpTree(t, {
    professions: catalogue([SIGNED]),
    domains: [SIGNED],
    competencies: [
      unit("step-1"),
      "",
      unit("step-2", { requires: ["step-1"], beyond: ["拆装不在本平台教——必须上车实操"] }),
      "",
      unit("step-3", { requires: ["step-2"], domains: [] }),
    ].join("\n"),
  });
  const professions = loadProfessions(tree.professionsFile);
  const competencies = loadCompetencies(tree.competenciesFile);
  const entry = capabilityMap(professions, competencies, new Set([SIGNED]), "test-profession");

  assert.ok(entry);
  assert.equal(entry.status, "open");
  assert.deepEqual(entry.covered.map((c) => c.unit.id), ["step-1", "step-2"]);
  assert.deepEqual(entry.planned.map((c) => c.unit.id), ["step-3"]);
  // By NAME: an id is not a route a learner can read.
  assert.deepEqual(entry.planned[0]?.after, ["单元-step-2"]);
  assert.deepEqual(entry.beyond, [{ unit: "单元-step-2", because: ["拆装不在本平台教——必须上车实操"] }]);
  // Two units answered 「无」. Counting them is the honest version of listing
  // them: `beyond (3)` would overstate the gap by half.
  assert.equal(entry.beyondNothing, 2);
});

test("a unit's `requires` outside its own Profession cannot bend the route", (t) => {
  // The ledger groups by Profession, so a prerequisite belonging to another
  // Profession is not in `units` and drops out of the ordering pass entirely —
  // it can neither be visited nor silently reorder a map it is not part of.
  const tree = tmpTree(t, {
    competencies: [unit("step-1", { requires: ["someone-elses-unit"] }), "", unit("step-2", { requires: ["step-1"] })].join(
      "\n",
    ),
  });
  const index = loadCompetencies(tree.competenciesFile);
  const own = [...index.competencies.values()].filter((unit: Competency) => unit.professionId === "test-profession");
  assert.deepEqual(
    orderCompetencies(own).map((unit) => unit.id),
    ["step-1", "step-2"],
  );
});
