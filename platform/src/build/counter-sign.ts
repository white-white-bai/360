import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { counterSignDomain } from "./review-domain.ts";

/**
 * `npm run counter-sign -- <domain-id>` — the second signature, at a terminal (ADR 0017).
 *
 * A CLI and never an MCP tool, for the same reason `review-domain` is: signing is a human act,
 * and a protocol that could call this would be a protocol that signs. What the command does with
 * the name it is given is decided in `counterSignDomain`, next to the first signature — this file
 * only asks for it.
 *
 * It is separate from `review-domain.ts` rather than a second `main()` in it, because both files
 * gate their own `main` on being the entry point, and one file cannot be two entry points.
 */

async function main(): Promise<void> {
  const id = (process.argv[2] ?? "").trim();
  if (id === "") {
    console.error("用法：npm run counter-sign -- <domain-id>");
    process.exitCode = 1;
    return;
  }

  console.log(`\n将要会签：domains/${id}`);
  console.log("第二位审核人给出的判断是独立的——不是复核第一位，而是自己读过语料之后签字。");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = (await rl.question("\n第二位审核人（写入 secondReviewedBy）> ")).trim();
    if (name === "") {
      console.error("没有名字就不签字——一次审核需要一个具体的人负责。");
      process.exitCode = 1;
      return;
    }

    let dir: string;
    try {
      dir = counterSignDomain(id, { name });
    } catch (error) {
      console.error(`\n${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n已会签 ${dir}。`);
    console.log("高风险职业在这一行配齐两名审核人、且每个 Domain 都会签之后才开放（ADR 0017）。");
    console.log("  npm run coverage   → 看这一行的状态是否从「未开放」变了");
  } finally {
    rl.close();
  }
}

// Only run when invoked directly; importing this in a test must not prompt anyone.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
