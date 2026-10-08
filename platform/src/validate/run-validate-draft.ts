import { validateDraft } from "./rules.ts";

/**
 * `npm run validate-draft -- <draft-dir>` — one draft, through the rule that already exists.
 *
 * This door exists for agents: the Python service's MCP server must not grow a second
 * implementation of a validation rule (two implementations diverge, and then which one the
 * signature gate consults becomes a coin toss). A drafting agent gets to ASK whether its draft
 * passes; the answer comes from the same validator the gate will use.
 */
function main(): void {
  const dir = process.argv.slice(2).join(" ").trim();
  if (dir === "") {
    console.error("用法：npm run validate-draft -- <draft-dir>");
    process.exitCode = 1;
    return;
  }

  const report = validateDraft(dir);
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        errors: report.errors,
        warnings: report.warnings,
        findings: report.findings.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          where: finding.where,
          message: finding.message,
        })),
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exitCode = 1;
}

main();
