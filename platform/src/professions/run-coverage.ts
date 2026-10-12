import {
  coverageLedger,
  signedDomainIdsOnDisk,
  type CoverageEntry,
} from "./coverage.ts";
import { loadCompetencies, loadProfessions, type ProfessionStatus } from "./load.ts";

/**
 * `npm run coverage` — the ledger ADR 0015 exists for.
 *
 * The question this whole line of work is about is *what is still missing for
 * this walk of life*, and this prints it from the same assets the entry panel
 * draws from, so the page and the report cannot disagree.
 *
 * It is a REPORT, not a gate: it always exits zero. "This Profession is still
 * missing four units" is an honest statement about how long the catalogue is,
 * not a defect in an asset, and a tool that failed on it would be telling the
 * truth about the repository in the language of a broken build.
 *
 *   npm run coverage                 # every Profession
 *   npm run coverage -- accountant   # one of them
 */

const STATUS_LABEL: Record<ProfessionStatus, string> = {
  open: "可学",
  planned: "待建",
  closed: "未开放",
};

function printEntry(entry: CoverageEntry): void {
  const { profession } = entry;
  console.log(`\n${profession.name}  (${profession.id} · ${STATUS_LABEL[entry.status]})`);
  console.log(`  boundary: ${profession.boundary}`);

  const units = entry.covered.length + entry.planned.length;
  if (units === 0) {
    console.log("  能力地图：还没有——这一行能学什么，要有人先写下能力单元");
    console.log("            在这之前，它显示为「待建」是诚实的，不是遗漏");
    return;
  }

  const route = (label: string, list: typeof entry.covered): void => {
    console.log(`  ${label} (${list.length})`);
    for (const item of list) {
      const after = item.after.length > 0 ? `   ← 先修：${item.after.join("、")}` : "";
      const domains =
        item.unit.domainIds.length > 0 ? item.unit.domainIds.join(", ") : "无已签字 Domain";
      console.log(`    · ${item.unit.name}${after}`);
      console.log(`        教它的教材：${domains}`);
    }
  };

  route("covered", entry.covered);
  route("planned", entry.planned);

  if (entry.beyond.length > 0 || entry.beyondNothing > 0) {
    console.log("  beyond（不在这里教）");
    for (const item of entry.beyond) {
      for (const line of item.because) console.log(`    · ${item.unit}：${line}`);
    }
    if (entry.beyondNothing > 0) {
      console.log(
        `    · 另有 ${entry.beyondNothing} 个单元写着「无」——完全落在认知层，不是留白（ADR 0015）`,
      );
    }
  }
}

function main(): void {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const signed = signedDomainIdsOnDisk();
  const index = loadProfessions();
  const competencies = loadCompetencies();

  console.log("Coverage ledger: what each walk of life can learn here (ADR 0015)");
  console.log("Computed from the same assets the entry panel draws from — the page and");
  console.log("this report cannot disagree. A report, not a gate: it always exits zero.");

  const ledger = coverageLedger(index, competencies, signed);
  const shown = wanted.length === 0 ? ledger : ledger.filter((e) => wanted.includes(e.profession.id));

  if (shown.length === 0) {
    console.log(`\nno Profession matched ${JSON.stringify(wanted.join(" "))}`);
    console.log(`known ids: ${ledger.map((entry) => entry.profession.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  for (const entry of shown) printEntry(entry);

  const count = (status: ProfessionStatus): number =>
    ledger.filter((entry) => entry.status === status).length;
  const units = ledger.reduce((sum, entry) => sum + entry.covered.length + entry.planned.length, 0);
  const missing = ledger.reduce((sum, entry) => sum + entry.planned.length, 0);

  console.log(`\n${"-".repeat(70)}`);
  console.log(
    `professions: ${ledger.length}   （可学 ${count("open")} · 待建 ${count("planned")} · 未开放 ${count("closed")}）`,
  );
  console.log(`competency units: ${units}   covered: ${units - missing}   planned: ${missing}`);
  console.log(
    "Every 「planned」 above is a person's decision, not a queue item (ADR 0006): the ledger says\n" +
      "what is missing, and never fills it in itself.",
  );
}

main();
