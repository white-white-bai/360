import { validateRepo } from "./rules.ts";
import type { Finding } from "./types.ts";

/**
 * `npm run validate`.
 *
 * Exits non-zero on errors and zero on warnings only, because a validator that
 * fails on judgement calls gets switched off, and a validator that passes on
 * broken assets is worse than none. See the note in `types.ts` for where that
 * line sits.
 */
function print(findings: Finding[], severity: "error" | "warning"): void {
  const selected = findings.filter((f) => f.severity === severity);
  if (selected.length === 0) return;

  console.log(`\n${severity === "error" ? "ERRORS" : "WARNINGS"} (${selected.length})`);
  for (const item of selected) {
    console.log(`  ${item.code}`);
    console.log(`    at   ${item.where}`);
    console.log(`    why  ${item.message}`);
    if (item.fix !== undefined) console.log(`    fix  ${item.fix}`);
  }
}

function main(): void {
  console.log("Validating the platform's configuration assets");
  console.log("(ADR 0006: a mis-configured Domain makes the acceptance experiment uninterpretable)");

  const report = validateRepo();

  print(report.findings, "error");
  print(report.findings, "warning");

  console.log(`\n${"-".repeat(70)}`);
  console.log(`errors: ${report.errors}   warnings: ${report.warnings}`);
  console.log(
    report.ok
      ? "RESULT: the assets pass every decidable rule. Warnings above are open questions,\n        not failures — read them before treating this Domain as ready."
      : "RESULT: the assets are NOT ready. Each error above names what is missing. This is\n        the intended state until the material is actually reviewed and owned: a green\n        validator that lies would put the experiment back on sand.",
  );

  if (!report.ok) process.exitCode = 1;
}

main();
