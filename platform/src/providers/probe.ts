import { costOf, isPlaceholderPrice } from "./pricing.ts";
import { configFromEnv, MissingProviderConfig, OpenAiCompatibleProvider } from "./openai.ts";
import { staleEnvHint, storedUserEnv } from "../util/stored-env.ts";
import { loadRepoEnv } from "../util/local-env.ts";

/**
 * `npm run probe` — one tiny live call, to find out whether the configuration
 * works before spending a session finding out the same thing.
 *
 * It prints the endpoint and the model but never the key: a diagnostic that leaks
 * a credential into a terminal or a log is worse than the failure it reports.
 */
async function main(): Promise<void> {
  // The repo's local .env first: a key that lives there is found before anything asks for one.
  loadRepoEnv();
  let config;
  try {
    config = configFromEnv();
  } catch (error) {
    if (error instanceof MissingProviderConfig) {
      console.error(`${error.message}\n`);
      // The most common reason a configured machine looks unconfigured: setx wrote the value
      // somewhere this process cannot see (see stored-env.ts). Say so before the user starts
      // wondering whether the key itself is wrong.
      const hint = staleEnvHint(storedUserEnv(["ATP_API_KEY", "ATP_MODEL"]), process.env);
      if (hint !== null) console.error(`${hint}\n`);
      console.error("Example (OpenAI-compatible, so any of OpenAI / DeepSeek / Qwen / Command Code / vLLM / Ollama):");
      console.error("  set ATP_BASE_URL=https://api.commandcode.ai/provider/v1");
      console.error("  set ATP_MODEL=deepseek/deepseek-v4.1-flash");
      console.error("  set ATP_API_KEY=...");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const provider = new OpenAiCompatibleProvider(config);
  console.log("Live provider probe");
  console.log(`  endpoint : ${provider.endpoint}`);
  console.log(`  model    : ${config.model}`);
  console.log(`  key      : ${"*".repeat(8)} (${config.apiKey.length} chars)`);
  console.log(`  timeout  : ${config.timeoutMs} ms`);
  console.log(
    `  price    : ${
      config.pricePerMTok === undefined
        ? "not set — the ledger will use the placeholder table, so treat any cost figure as a guess"
        : `$${config.pricePerMTok.input}/M in, $${config.pricePerMTok.output}/M out`
    }`,
  );
  console.log(
    `  zdr      : ${
      config.zdr === true
        ? "on — the request must route through a zero-data-retention upstream, or it fails"
        : "off"
    }`,
  );

  const started = Date.now();
  try {
    const completion = await provider.complete({
      actor: "probe",
      model: config.model,
      system: "You are a connectivity probe. Answer with the single word: ok",
      input: "ok?",
      expectedOutputTokens: 4,
    });
    const elapsed = Date.now() - started;

    console.log("\nResponse");
    console.log(`  latency  : ${elapsed} ms`);
    console.log(`  text     : ${JSON.stringify(completion.text.slice(0, 120))}`);
    console.log(`  tokens   : ${completion.usage.inputTokens} in, ${completion.usage.outputTokens} out`);
    const cost = costOf(config.model, completion.usage.inputTokens, completion.usage.outputTokens);
    const placeholder = isPlaceholderPrice(config.model);
    console.log(
      `  cost     : ${placeholder ? "≈" : ""}$${cost.toFixed(6)}` +
        (placeholder ? "   (placeholder prices — not a measurement)" : ""),
    );
    if (provider.usageEstimated) {
      console.log("  NOTE     : the endpoint reported no usage, so the token counts above are estimates");
    }
    console.log("\nThe provider is reachable and speaks the expected shape.");
  } catch (error) {
    console.error(`\nFAILED after ${Date.now() - started} ms`);
    console.error(`  ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

await main();
