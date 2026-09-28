import type { UnderstandingCheck, CheckVerdict } from "../checks/types.ts";
import { gradeObjectively } from "../checks/grade.ts";
import type { Expert } from "../experts/types.ts";
import type { LedgerRow } from "../providers/meter.ts";
import { SpendMeter } from "../providers/meter.ts";
import type { ModelProvider } from "../providers/types.ts";
import { excerpt } from "../grounding/corpus.ts";
import type { SessionLog } from "../events/log.ts";
import { emptyLog } from "../events/log.ts";
import type { Surface } from "../render/render.ts";
import { render } from "../render/render.ts";
import { parseExplanation } from "./explanation.ts";
import { applySteps } from "./turn.ts";
import type { SessionStore } from "./store.ts";

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
 * arrive interleaved in one payload (ADR 0005), and lists the closed event
 * vocabulary, because a model cannot use a primitive it has not been told about.
 */
export function buildExplainerPrompt(expert: Expert): { system: string; input: string } {
  const { persona, style, domain } = expert;

  const system = [
    "You are the Lead Explainer in a teaching session.",
    "There is exactly one explainer. Do not hand the lesson to anyone else.",
    "",
    "# Persona — who is speaking",
    `name: ${persona.name}`,
    `stance: ${persona.stance}`,
    `register: ${persona.register}`,
    "",
    "# Style — how the explanation is built",
    `analogyDensity: ${style.analogyDensity}`,
    `order: ${style.order}`,
    `abstraction: ${style.abstraction}`,
    `exampleType: ${style.exampleType}`,
    "",
    "# Domain — what you may assert",
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
    "Do not include an `at` field — position on the timeline is assigned for you.",
    "",
    "# Blackboard vocabulary (closed — nothing outside this list)",
    '- text:  {id, body}',
    '- shape: {id, shape: rect|ellipse|arrow|line, from, to}   from/to are element ids',
    '- axis:  {id, label, from, to, marks:[{value, label?}]}   a scale; numbers are domain values, not pixels',
    '- band:  {id, axis, from, to, label, emphasis: neutral|attention}   a span on an axis',
    '- table: {id, columns:[...], rows:[[...]]}   rows must match the column count',
    '- point:     {target}   move attention to an existing element',
    '- highlight: {target}   mark an existing element as the thing to notice',
    '- erase:     {target}   remove an existing element',
    '- rich:      {id, format: mermaid|excalidraw|svg, body, declared: true}',
    "Prefer axis + band over paragraphs when something has a scale or a range:",
    "the renderer lays them out, you only say what they mean.",
    "`rich` is a declared escape hatch. Use it only when nothing above can express the idea.",
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
  /** When present, the session is persisted so it can be resumed (ADR 0002). */
  store?: SessionStore;
}

export interface BaselineResult {
  log: SessionLog;
  surface: Surface;
  verdict: CheckVerdict;
  usage: LedgerRow;
  saved: boolean;
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

  const sessionId = input.sessionId ?? `baseline-${input.expert.domain.id}`;
  const log = applySteps(emptyLog(sessionId), explanation.steps, "lead-explainer");
  const surface = render(log.events);

  // The check is an asset and the comparison is objective, so grading makes no
  // model call — and, more importantly, the explainer is not involved in it.
  const verdict = gradeObjectively(input.check, input.learnerAnswer);

  let saved = false;
  if (input.store !== undefined) {
    input.store.save(log);
    saved = input.store.has(sessionId);
  }

  return { log, surface, verdict, usage: meter.total(), saved };
}
