import { createInterface } from "node:readline/promises";

import type { UnderstandingCheck } from "../checks/types.ts";
import type { EntryOption } from "../experts/catalogue.ts";
import { NotOffered, catalogue, choose } from "../experts/catalogue.ts";
import { loadLibrary } from "../experts/load.ts";
import { describeExpert } from "../experts/types.ts";
import type { Expert } from "../experts/types.ts";
import { selectLiveProvider } from "../providers/live.ts";
import { ScriptedProvider } from "../providers/scripted.ts";
import type { ModelProvider } from "../providers/types.ts";
import { render } from "../render/render.ts";
import { surfaceToText } from "../render/text.ts";
import { runApparatusSession } from "../session/apparatus.ts";
import { misconceptionScript } from "../session/fixtures-apparatus.ts";
import { MEANINGFUL_RETENTION_HOURS, measureFollowUp } from "../session/measure.ts";
import { FileSessionStore } from "../session/store.ts";

/**
 * The way in, and the way back.
 *
 * ADR 0007 makes entry two steps — pick a Domain, then pick how it is taught. ADR 0013 makes
 * participation mandatory but cheap: a probe is one sentence and is not scored. This is
 * where both stop being designs and start being a lesson somebody actually sits through.
 *
 * Until now this file taught AT the learner. The probes were placed in the narration, the
 * check was graded — and every answer came from three strings hard-coded here, so a person
 * could watch a lesson but not take one. The apparatus gained the ability to ASK; this is
 * the thing that answers it, and the reason `npm run enter` is now worth running.
 *
 * `--followup <id>` is the other half. ADR 0001 calls retention and transfer secondary
 * measures and says they matter more than they look; they were implemented, measured and
 * reported, but only ever for simulated learners. Coming back a day later is now something a
 * person can do, which is the only way either number ever means anything about a person.
 */
const library = loadLibrary();
const store = new FileSessionStore();
const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question: string): Promise<string> {
  return (await rl.question(question)).trim();
}

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

async function askFor(prompt: string, options: readonly EntryOption[]): Promise<string> {
  for (;;) {
    const id = resolve(options, await ask(`${prompt} > `));
    if (id !== undefined) return id;
    // Not "defaulting to the first one". A learner who mistyped has told us nothing, and a
    // default here would be the platform choosing on their behalf again.
    console.log("  没有这一项，请从上面的列表里选（输入序号或 id）。");
  }
}

/** Put one question to the learner, and say when a bare Enter is an acceptable answer. */
async function put(question: string, prompt: string, skippable: boolean): Promise<string> {
  console.log(`\n【问】${question}`);
  return ask(skippable ? `${prompt}（直接回车表示跳过）> ` : `${prompt}> `);
}

async function lesson(expert: Expert, provider: ModelProvider): Promise<void> {
  const offered = catalogue(library);
  const terminalChecks = expert.domain.checks.filter((candidate) => !candidate.id.startsWith("T-"));
  const check = terminalChecks[0];
  if (check === undefined) {
    console.error(`\n${expert.domain.id} has no terminal check, so there is nothing to teach.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n开始上课：${describeExpert(expert)}`);
  console.log("（讲课内容会逐段出现；问题问到你的时候，回答就好。）");

  // Narration, printed as it lands. The board is shown at the end rather than redrawn per
  // step: a screen that scrolls while you are reading it is not a lesson.
  let spoken = 0;
  const onStep = (log: { narration: Array<{ actor: string; text: string }> }): void => {
    for (const chunk of log.narration.slice(spoken)) {
      console.log(chunk.actor === "challenger" ? `\n【质疑者】${chunk.text}` : `\n${chunk.text}`);
    }
    spoken = log.narration.length;
  };

  const sessionId = `lesson-${Date.now()}`;
  const result = await runApparatusSession(provider, {
    expert,
    check,
    // The second sitting gets a different asset where the Domain offers one, so a pass after
    // remediation cannot be recall of the question that was just failed.
    retakeCheck: terminalChecks[1],
    probeAnswers: [],
    terminalAnswer: "",
    askProbe: async (probe) => {
      const answer = await put(probe.prompt, "你答", true);
      return answer === "" ? undefined : answer;
    },
    askTerminal: async (asked: UnderstandingCheck) => put(asked.prompt, "你答", false),
    askRetake: async (asked) => {
      const answer = await put(asked.prompt, "你答", true);
      return answer === "" ? undefined : answer;
    },
    sessionId,
    store,
    onStep,
  });

  console.log("\n— 黑板（下课时） —\n" + surfaceToText(render(result.log.events)));

  const final = result.verdictAfterRetry ?? result.verdict;
  console.log(`\n结果：${final?.verdict === "pass" ? "通过" : "未通过"} · ${final?.checkId ?? "n/a"}`);
  if (final?.diagnosis != null) {
    console.log(`  诊断：${final.diagnosis.reason}`);
    console.log(`  对应误解：${final.diagnosis.misconceptionId ?? "（不在编目里，已记入待编目队列）"}`);
  }
  console.log(`调用 ${result.usage.calls} 次${result.retries > 0 ? `（其中 ${result.retries} 次是因为模型答坏了重来）` : ""}`);
  console.log(`阶段：${result.phases.join(" → ")}`);

  console.log(`\n这节课已经存下来了（${sessionId}）。`);
  console.log("要真正测到「隔天还记得吗」，就明天回来跑：");
  console.log(`  npm run enter -- --followup ${sessionId}`);
}

/**
 * Come back later, and be measured.
 *
 * The elapsed time is real here — this is the only place in the platform where it is. The
 * experiment moves the clock because an experiment that spent a day per trial would not be
 * run; a person who comes back tomorrow has actually come back tomorrow, and that is the
 * difference the two records are kept to preserve.
 */
async function followUp(id: string): Promise<void> {
  const log = store.load(id);
  if (log.startedAt === null || log.domainId === null) {
    console.error(`\n${id} does not say when it happened or what it taught, so it cannot be followed up.`);
    process.exitCode = 1;
    return;
  }

  const domain = library.domains.get(log.domainId);
  if (domain === undefined) {
    console.error(`\n${id} was taught in ${log.domainId}, which is no longer in the library.`);
    process.exitCode = 1;
    return;
  }

  const hours = (Date.now() - Date.parse(log.startedAt)) / 3_600_000;
  console.log(`\n距上一节课过了 ${hours.toFixed(1)} 小时。`);
  if (hours < MEANINGFUL_RETENTION_HOURS) {
    console.log(`（不到 ${MEANINGFUL_RETENTION_HOURS} 小时，所以下面的数字还不算「隔天保留」。）`);
  }

  let current = log;
  const retentionAsset = domain.checks.find((candidate) => !candidate.id.startsWith("T-"));
  if (retentionAsset !== undefined) {
    const answer = await put(retentionAsset.prompt, "你答", false);
    const measured = measureFollowUp(current, retentionAsset, "retention", answer);
    current = measured.log;
    console.log(`  保留：${measured.record.verdict === "pass" ? "通过" : "未通过"}（同一个问题，隔了一段时间）`);
  }

  const transferAsset = domain.checks.find((candidate) => candidate.id.startsWith("T-"));
  if (transferAsset !== undefined) {
    const answer = await put(transferAsset.prompt, "你答", true);
    if (answer !== "") {
      const measured = measureFollowUp(current, transferAsset, "transfer", answer);
      current = measured.log;
      console.log(`  迁移：${measured.record.verdict === "pass" ? "通过" : "未通过"}（课上没出现过的新处境）`);
    } else {
      console.log("  迁移：没答，记为无数据（沉默不是答错）。");
    }
  }

  store.save(current);
  console.log(`\n两次测量都记进 ${id} 了。`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const followIndex = argv.indexOf("--followup");
  if (followIndex !== -1) {
    const id = argv[followIndex + 1];
    if (id === undefined) {
      console.error("--followup needs a session id.");
      process.exitCode = 1;
      return;
    }
    await followUp(id);
    return;
  }

  const demo = argv.includes("--demo");
  const preset = argv.filter((arg) => !arg.startsWith("--"));
  const scripted = preset.length === 3;

  console.log("进入学习：先选学什么，再选怎么教（ADR 0007）");
  const offered = catalogue(library);

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
    if (error instanceof NotOffered) {
      console.error(`\n${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const live = selectLiveProvider();
  if (live === null && !demo) {
    // A lesson needs a teacher. The scripted fixture is a demonstration of the loop and is
    // labelled as one, because a person sitting through it is not learning anything.
    console.error("\n没有配置 provider，所以没人能来讲这节课。");
    console.error("要上一节真课，先设置（OpenAI 兼容，覆盖 DeepSeek / Qwen / vLLM / Ollama 等）：");
    console.error('  set ATP_BASE_URL=https://api.deepseek.com/v1');
    console.error("  set ATP_MODEL=deepseek-chat");
    console.error("  set ATP_API_KEY=...");
    console.error("\n只想看一遍流程（不讲真内容）：npm run enter -- --demo");
    process.exitCode = 1;
    return;
  }

  if (live === null) {
    console.log("\n【演示模式】下面是录制好的时区那一课。这不是给你上的课。");
    if (expert.domain.id !== "time-zones") {
      console.error("  录制脚本只有 time-zones 的，换 Domain 需要一套新的录制。");
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`\n【实时】${live.describe}`);
  }

  const provider = live?.provider ?? new ScriptedProvider(misconceptionScript());
  await lesson(expert, provider);
}

try {
  await main();
} finally {
  rl.close();
}
