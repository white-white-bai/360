import { createInterface } from "node:readline/promises";

import { findCheck } from "../checks/load.ts";
import { loadLibrary } from "../experts/load.ts";
import type { EntryOption } from "../experts/catalogue.ts";
import { NotOffered, catalogue, choose } from "../experts/catalogue.ts";
import { describeExpert } from "../experts/types.ts";
import type { Expert } from "../experts/types.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import { render } from "../render/render.ts";
import { surfaceToText } from "../render/text.ts";
import { runApparatusSession } from "../session/apparatus.ts";
import { misconceptionScript } from "../session/fixtures-apparatus.ts";

/**
 * The way in.
 *
 * ADR 0007 makes entry two steps — pick a Domain, then pick how it is taught — and this
 * is that, plus a class so the choice can be seen doing something. Nothing here decides
 * anything on the learner's behalf: if they name something that was not offered, the
 * resolver refuses and the question is asked again.
 *
 * Fully scriptable: pass three ids and it skips the prompts, so the path is testable and
 * so a scripted demo does not have to pretend to be a person at a keyboard.
 */
const library = loadLibrary();
const offered = catalogue(library);

function list(title: string, step: string, options: readonly EntryOption[]): void {
  console.log(`\n${step} ${title}`);
  for (const [index, option] of options.entries()) {
    console.log(`  ${String(index + 1).padStart(2)}. ${option.label}  (${option.id})`);
    console.log(`      ${option.detail}`);
  }
}

/** Accept either the position shown or the id, because both are things people type. */
function resolve(options: readonly EntryOption[], typed: string): string | undefined {
  const trimmed = typed.trim();
  const byId = options.find((option) => option.id === trimmed);
  if (byId !== undefined) return byId.id;
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return (options[index - 1] as EntryOption).id;
  }
  return undefined;
}

async function askFor(
  prompt: string,
  options: readonly EntryOption[],
): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const typed = await rl.question(`${prompt} > `);
      const id = resolve(options, typed);
      if (id !== undefined) return id;
      // Not "defaulting to the first one". A learner who mistyped has told us nothing,
      // and a default here would be the platform choosing on their behalf again.
      console.log(`  没有这一项，请从上面的列表里选（输入序号或 id）。`);
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const preset = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const scripted = preset.length === 3;

  console.log("进入学习：先选学什么，再选怎么教（ADR 0007）");

  if (!scripted) {
    list("可学的 Domain", "第一步", offered.domains);
    console.log("  说明：目录的长度就是「能教什么」的诚实说法。");
  }
  const domainId = scripted ? (preset[0] as string) : await askFor("选一个 Domain", offered.domains);

  if (!scripted) {
    list("谁来教（Persona）", "第二步", offered.personas);
    list("怎么教（Style）", "第二步", offered.styles);
  }
  const personaId = scripted ? (preset[1] as string) : await askFor("选一个 Persona", offered.personas);
  const styleId = scripted ? (preset[2] as string) : await askFor("选一个 Style", offered.styles);

  let expert: Expert;
  try {
    expert = choose(library, domainId, personaId, styleId);
  } catch (error) {
    // A scripted run can name anything, so the refusal has to be visible rather than
    // silently rounded to the nearest offer.
    if (error instanceof NotOffered) {
      console.error(`\n${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(`\n开始上课：${describeExpert(expert)}`);

  // The checks come from whichever Domain was chosen, not from a hard-coded id. Entry is
  // the one path that crosses Domains, so a hard-coded `C-gap` would mean adding a Domain
  // silently broke the way in — which is exactly what it did before this line.
  const terminalChecks = expert.domain.checks.filter((candidate) => !candidate.id.startsWith("T-"));
  const check = terminalChecks[0];
  if (check === undefined) {
    console.error(`\n${expert.domain.id} has no terminal check, so there is nothing to run.`);
    process.exitCode = 1;
    return;
  }

  // The recorded responses below were scripted for the time-zones lesson. A scripted
  // demo of another Domain would be that fixture wearing its name, so the flow stops at
  // the choice and says why, rather than passing one lesson's script off as another's.
  if (expert.domain.id !== "time-zones") {
    console.log(`\n选择完成：${describeExpert(expert)}`);
    console.log("  这份演示只有 time-zones 的录制脚本。换 Domain 需要一套新的录制，");
    console.log("  所以到此为止，而不是拿别的课的脚本冒充这一课。");
    console.log(`  这门 Domain 的资产可以用 \`npm run validate\` 检查。`);
    return;
  }

  let board = "";
  const result = await runApparatusSession(new ScriptedProvider(misconceptionScript()), {
    expert,
    check,
    retakeCheck: terminalChecks[1],
    probeAnswers: ["夏令时就是把偏移量改一下"],
    terminalAnswer: "这个本地时间正常存在，只是偏移量不同",
    retryAnswer: "这个本地时间出现两次，只给本地时间无法确定是哪一次",
    sessionId: `entry-${Date.now()}`,
    // The board, redrawn from the events as they land. This is the same pure function
    // the page consumes; the text renderer exists so the loop can be watched without a
    // browser, and keeping it a consumer of `Surface` is why there is still one renderer.
    onStep: (log) => {
      board = surfaceToText(render(log.events));
    },
  });

  console.log("\n— 黑板（下课时） —\n" + board);

  const final = result.verdictAfterRetry ?? result.verdict;
  console.log(`\n结果：${final?.verdict === "pass" ? "通过" : "未通过"} · ${final?.checkId ?? "n/a"}`);
  console.log(`调用 ${result.usage.calls} 次，$${result.usage.costUsd.toFixed(4)}`);
  console.log(`阶段：${result.phases.join(" → ")}`);
}

await main();
