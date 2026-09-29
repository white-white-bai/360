import { createInterface } from "node:readline/promises";

import { loadLibrary } from "../experts/load.ts";
import { selectLiveProvider } from "../providers/live.ts";
import { CLASSROOM_ACTOR, runClassroomTurn } from "./classroom.ts";
import type { ClassroomMessage } from "./classroom.ts";

/**
 * `npm run classroom -- "<主题>"` — the direct classroom (ADR 0011), before the board has it.
 *
 * A conversation, not a lesson: the learner types, the teacher answers from the model's own
 * knowledge, and the header says out loud that nothing here was verified against anything.
 * The terminal is the cheapest way to find out whether the prompts teach; the page's entry
 * gains the same mode after this.
 *
 * Options: `--persona <id>`, `--style <id>`, `--challenger <id>`. Everything is optional
 * except the subject.
 */

const DEFAULTS = {
  persona: "patient-explainer",
  style: "analogy-heavy",
  challenger: "terse-engineer",
} as const;

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = ["--persona", "--style", "--challenger"];
  const topic = argv
    .filter((arg, index) => !flags.includes(arg) && !flags.includes(argv[index - 1] ?? ""))
    .join(" ")
    .trim();

  if (topic === "") {
    console.error('用法：npm run classroom -- "<你想学的主题>" [--persona id] [--style id] [--challenger id]');
    process.exitCode = 1;
    return;
  }

  const live = selectLiveProvider();
  if (live === null) {
    console.error("\n没有配置 provider，没有人能来讲这节课（直接课堂也要模型）。");
    console.error("先设置 ATP_API_KEY 和 ATP_MODEL（ATP_BASE_URL 可选；见 npm run probe）。");
    process.exitCode = 1;
    return;
  }

  const library = loadLibrary();
  const pick = <T>(map: Map<string, T>, id: string, what: string): T => {
    const found = map.get(id);
    if (found === undefined) {
      console.error(`没有 ${what} \`${id}\`；可选：${[...map.keys()].sort().join(", ")}`);
      process.exit(1);
    }
    return found;
  };

  const setup = {
    persona: pick(library.personas, option(argv, "--persona") ?? DEFAULTS.persona, "Persona"),
    style: pick(library.styles, option(argv, "--style") ?? DEFAULTS.style, "Style"),
    challenger: pick(library.personas, option(argv, "--challenger") ?? DEFAULTS.challenger, "Persona（质疑者）"),
    topic,
  };

  console.log(`\n【直接课堂】${setup.topic}`);
  console.log(`主讲：${setup.persona.name} · 质疑者：${setup.challenger.name} · 风格：${setup.style.name}`);
  console.log(`provider  ${live.describe}`);
  console.log("直接课堂：回答由模型现场给出，未经过语料校验。（输入 exit 结束。）");

  const history: ClassroomMessage[] = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let calls = 0;
  let costUsd = 0;

  const show = (turns: { actor: string; text: string }[]): void => {
    for (const turn of turns) {
      const who = turn.actor === CLASSROOM_ACTOR.challenger ? "质疑者" : "主讲";
      console.log(`\n【${who}】${turn.text}`);
    }
  };

  try {
    // The learner's first message is the request to be taught; the teacher answers it.
    const opening = await runClassroomTurn({ provider: live.provider, setup, history, message: `我想学：${topic}` });
    calls += opening.usage.calls;
    costUsd += opening.usage.costUsd;
    history.push({ role: "learner", text: `我想学：${topic}` });
    show(opening.turns);
    for (const turn of opening.turns) history.push({ role: "teacher", actor: turn.actor, text: turn.text });

    for (;;) {
      const said = (await rl.question("\n你 > ")).trim();
      if (said === "") continue;
      if (said === "exit" || said === "quit" || said === "退出") break;

      const turnResult = await runClassroomTurn({ provider: live.provider, setup, history, message: said });
      calls += turnResult.usage.calls;
      costUsd += turnResult.usage.costUsd;
      history.push({ role: "learner", text: said });
      show(turnResult.turns);
      for (const turn of turnResult.turns) history.push({ role: "teacher", actor: turn.actor, text: turn.text });
    }
  } finally {
    rl.close();
  }

  console.log(`\n下课。调用 ${calls} 次${costUsd === 0 ? "" : ` · 约 $${costUsd.toFixed(4)}`}。`);
  console.log("（这个模式没有作业、没有检查、没有记录——要能被验证和回访的课，用 npm run enter。）");
}

await main();
