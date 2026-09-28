import { FakeProvider } from "../providers/fake.ts";
import { SpendMeter } from "../providers/meter.ts";
import { FALLBACK_PRICE } from "../providers/pricing.ts";
import { allShapes } from "./shapes.ts";
import { DRIVERS } from "./shapes.ts";

const usd = (n: number): string => `$${n.toFixed(4)}`;
const tok = (n: number): string => String(n);

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padStart(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

async function measure(shape: ReturnType<typeof allShapes>[number]) {
  const meter = new SpendMeter(new FakeProvider());
  for (const c of shape.calls) {
    await meter.complete(c.request);
  }
  return { shape, meter };
}

async function main(): Promise<void> {
  console.log("Phase 0 — session cost estimate");
  console.log("MODELLED, NOT MEASURED. No model was called; see the assumptions.\n");

  console.log("Assumptions");
  console.log(`  price ............ mid tier = $${FALLBACK_PRICE.inputPerMTok}/M in, $${FALLBACK_PRICE.outputPerMTok}/M out`);
  console.log("                     ^ PLACEHOLDER — replace with your model's real prices");
  console.log("  token estimator .. CJK ~1 token/char, other ~1 token/4 chars (biased high)");
  console.log("  delivery language  Chinese, corpus English -> mixed text, CJK counted separately");
  console.log(`  corpus excerpt ... ${tok(DRIVERS.corpusExcerptTokens)} tokens per session`);
  console.log(`  probes ........... ${DRIVERS.probeCount} per session, each evaluated separately`);
  console.log("  note ............. no retries, no cache hits, no prompt reuse assumed");
  console.log();

  const results = [];
  for (const shape of allShapes()) {
    results.push(await measure(shape));
  }

  const totals = new Map<string, number>();

  for (const { shape, meter } of results) {
    console.log(`${shape.id.toUpperCase()} — ${shape.label}`);
    console.log(
      `  ${pad("actor", 20)}${padStart("calls", 7)}${padStart("in tok", 10)}${padStart("out tok", 10)}${padStart("USD", 11)}`,
    );
    for (const row of meter.ledger()) {
      console.log(
        `  ${pad(row.actor, 20)}${padStart(String(row.calls), 7)}${padStart(tok(row.inputTokens), 10)}${padStart(tok(row.outputTokens), 10)}${padStart(usd(row.costUsd), 11)}`,
      );
    }
    const total = meter.total();
    totals.set(shape.id, total.costUsd);
    console.log(
      `  ${pad("TOTAL", 20)}${padStart(String(total.calls), 7)}${padStart(tok(total.inputTokens), 10)}${padStart(tok(total.outputTokens), 10)}${padStart(usd(total.costUsd), 11)}`,
    );
    console.log();
  }

  const base = totals.get("baseline") ?? 0;
  const app = totals.get("apparatus") ?? 0;
  const baseCalls = results[0]?.meter.total().calls ?? 0;
  const appCalls = results[1]?.meter.total().calls ?? 0;

  console.log("Comparison");
  console.log(`  calls      ${baseCalls} -> ${appCalls}   (${(appCalls / baseCalls).toFixed(2)}x)`);
  console.log(`  cost       ${usd(base)} -> ${usd(app)}   (${(app / base).toFixed(2)}x)`);
  console.log(`  delta      ${usd(app - base)} per session`);
  console.log();
  const appTotal = results[1]?.meter.total();
  if (appTotal && appTotal.costUsd > 0) {
    const inCost = (appTotal.inputTokens / 1_000_000) * FALLBACK_PRICE.inputPerMTok;
    const outCost = (appTotal.outputTokens / 1_000_000) * FALLBACK_PRICE.outputPerMTok;
    const narrationOut = DRIVERS.narrationTokens * 2; // the narration and the re-teach
    const narrationCost = (narrationOut / 1_000_000) * FALLBACK_PRICE.outputPerMTok;

    console.log("Where the money goes (apparatus)");
    console.log(
      `  input    ${tok(appTotal.inputTokens)} tok   ${usd(inCost)}   ${((inCost / appTotal.costUsd) * 100).toFixed(0)}% of cost`,
    );
    console.log(
      `  output   ${tok(appTotal.outputTokens)} tok   ${usd(outCost)}   ${((outCost / appTotal.costUsd) * 100).toFixed(0)}% of cost`,
    );
    console.log();
    console.log("  Cost is driven by how much is WRITTEN, not by how many actors speak.");
    console.log(
      `  Narration + re-teach is ${tok(narrationOut)} of ${tok(appTotal.outputTokens)} output tokens ` +
        `(${((narrationOut / appTotal.outputTokens) * 100).toFixed(0)}%), i.e. ${usd(narrationCost)} ` +
        `= ${((narrationCost / appTotal.costUsd) * 100).toFixed(0)}% of the session.`,
    );
    console.log("  That is ADR 0003's 'one explainer' argument in money: several personas each");
    console.log("  producing narration would multiply the dominant term, not the cheap one.");
    console.log();
  }

  console.log("Read this before reacting to the call count");
  console.log("  The call count grows far faster than the cost, because the two-phase");
  console.log("  design (ADR 0005) keeps the corpus out of narration and re-teaching.");
  console.log("  The corpus excerpt is the single biggest input, and the apparatus pays");
  console.log("  for it once instead of on every pass. A 4x call count is not a 4x bill.");
  console.log();
  console.log("What would change the conclusion");
  console.log("  - real prices (the placeholder is the weakest input here)");
  console.log("  - whether narration really needs the corpus removed (measure it)");
  console.log("  - probe count: probes are the largest *count* of calls");
  console.log("  - prompt caching: real providers discount repeated prefixes heavily,");
  console.log("    which this model does not assume at all");
}

await main();
