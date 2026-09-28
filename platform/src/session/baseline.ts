import type { UnderstandingCheck, CheckVerdict } from "../checks/types.ts";
import { gradeObjectively } from "../checks/grade.ts";
import type { Expert } from "../experts/types.ts";
import type { LedgerRow } from "../providers/meter.ts";
import { SpendMeter } from "../providers/meter.ts";
import type { ModelProvider } from "../providers/types.ts";
import { excerpt } from "../grounding/corpus.ts";
import type { SessionLog } from "../events/log.ts";
import { appendEvent, appendNarration, emptyLog } from "../events/log.ts";
import type { Surface } from "../render/render.ts";
import { render } from "../render/render.ts";
import { parseExplanation } from "./explanation.ts";

/** Actor ids. Separate from Position names so the ledger stays legible. */
export const ACTOR = {
  explainer: "lead-explainer",
} as const;

const MODEL = "mid";

/**
 * The prompt for one explanation.
 *
 * Three things it must carry, each traceable to a decision:
 *   - Persona and Style, as separate blocks, so the axes stay swappable (ADR 0006)
 *   - the corpus passages WITH their ids, so an assertion can be traced back (ADR 0004)
 *   - the Term Glossary and the never-translate list (ADR 0018)
 *
 * It also states the output contract, because narration and blackboard events
 * arrive interleaved in one payload (ADR 0005).
 */
export function buildExplainerPrompt(expert: Expert): { system: string; input: string } {
  const { persona, style, domain } = expert;

  const system = [
    "You are the Lead Explainer in a teaching session.",
    "There is exactly one explainer. Do not hand the lesson to anyone else.",
    "",
    `# Persona — who is speaking`,
    `name: ${persona.name}`,
    `stance: ${persona.stance}`,
    `register: ${persona.register}`,
    "",
    `# Style — how the explanation is built`,
    `analogyDensity: ${style.analogyDensity}`,
    `order: ${style.order}`,
    `abstraction: ${style.abstraction}`,
    `exampleType: ${style.exampleType}`,
    "",
    `# Domain — what you may assert`,
    `name: ${domain.name}`,
    "Every statement about the world must be supported by one of the corpus passages below.",
    "Anything the passages do not support must be either dropped or openly marked as an analogy,",
    "never asserted. If the passages do not settle something, say you do not know.",
    "",
    `# Delivery language: ${domain.deliveryLanguage}`,
    "The corpus is in its source language. Teach in the delivery language, and render terms",
    "exactly as the Term Glossary gives them. Identifiers in the never-translate list are",
    "citations: reproduce them unchanged.",
    "",
    "# Corpus passages",
    ...excerpt(domain.corpus).map((p) => `## ${p.id}\nsource: ${p.source}\ntext: ${p.text}`),
    "",
    "# Term Glossary",
    ...Object.entries(domain.glossary.terms).map(([term, rendering]) => `${term} => ${rendering}`),
    `never translate: ${domain.glossary.neverTranslate.join(", ")}`,
    "",
    "# Output contract",
    "Return JSON only, no prose around it:",
    `{"steps":[{"say":"..."},{"event":{"kind":"text","id":"...","body":"..."}}]}`,
    "Interleave `say` and `event` so the board fills in as you speak.",
    "Event kinds: text, shape, point, highlight, erase, rich.",
    "Do not include an `at` field — position on the timeline is assigned for you.",
  ].join("\n");

  const input = [
    "Teach the single most load-bearing idea in this Domain to a learner who believes they",
    "already understand it. Lead with the idea that, if they get it wrong, makes everything",
    "else wrong too.",
  ].join("\n");

  return { system, input };
}

export interface BaselineInput {
  expert: Expert;
  check: UnderstandingCheck;
  learnerAnswer: string;
  sessionId?: string;
}

export interface BaselineResult {
  log: SessionLog;
  surface: Surface;
  verdict: CheckVerdict;
  usage: LedgerRow;
}

/**
 * The ablated baseline (ADR 0001): one strong explainer plus the terminal check,
 * with no apparatus at all.
 *
 * What is deliberately absent, and why each absence matters:
 *   - no assertion list, so nothing is verified before it is said
 *   - no probes, so a misconception in the middle is not noticed until the end
 *   - no grounding verifier, so the material is only as good as the prompt
 *   - no challenger, so a failed check ends the session instead of being refuted
 *
 * This is the comparison object. It has to exist regardless of how good the
 * apparatus turns out to be, because without it "the apparatus helps" is an
 * opinion.
 */
export async function runBaselineSession(
  provider: ModelProvider,
  input: BaselineInput,
): Promise<BaselineResult> {
  const meter = new SpendMeter(provider);
  const prompt = buildExplainerPrompt(input.expert);

  const completion = await meter.complete({
    actor: ACTOR.explainer,
    model: MODEL,
    system: prompt.system,
    input: prompt.input,
  });

  const explanation = parseExplanation(completion.text);

  let log = emptyLog(input.sessionId ?? `baseline-${input.expert.domain.id}`);
  let at = 0;
  for (const step of explanation.steps) {
    if (step.say !== undefined) {
      log = appendNarration(log, { at, actor: "lead-explainer", text: step.say });
      at += 1;
      continue;
    }
    if (step.event !== undefined) {
      log = appendEvent(log, { ...step.event, at });
      at += 1;
    }
  }

  const surface = render(log.events);

  // The check is an asset and the comparison is objective, so grading makes no
  // model call — and, more importantly, the explainer is not involved in it.
  const verdict = gradeObjectively(input.check, input.learnerAnswer);

  return { log, surface, verdict, usage: meter.total() };
}
