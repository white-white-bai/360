import { parseAssertionList } from "../assertions/parse.ts";
import type { AssertionList } from "../assertions/types.ts";
import type { CheckVerdict, UnderstandingCheck } from "../checks/types.ts";
import { gradeObjectively } from "../checks/grade.ts";
import type { Expert } from "../experts/types.ts";
import { verifyAssertionList } from "../grounding/verify.ts";
import type { ListVerdict } from "../grounding/verify.ts";
import type { SessionLog } from "../events/log.ts";
import { emptyLog } from "../events/log.ts";
import type { LedgerRow } from "../providers/meter.ts";
import { SpendMeter } from "../providers/meter.ts";
import type { ModelProvider } from "../providers/types.ts";
import type { Surface } from "../render/render.ts";
import { render } from "../render/render.ts";
import type { Probe, ProbeOutcome, SemanticVerdict } from "./contracts.ts";
import { parseProbeOutcome, parseProbes, parseSemanticVerdicts } from "./contracts.ts";
import type { ExplanationStep } from "./explanation.ts";
import { parseExplanation } from "./explanation.ts";
import { BLACKBOARD_CONTRACT, corpusBlock, framing, glossaryBlock, misconceptionBlock } from "./prompt.ts";
import type { SessionStore } from "./store.ts";
import { applySteps } from "./turn.ts";

/** Actor ids. One line each in the ledger, and one per ADR 0004's independence rule. */
export const ACTOR = {
  explainer: "lead-explainer",
  semanticVerifier: "grounding-verifier",
  probeAuthor: "probe-author",
  probeEvaluator: "probe-evaluator",
  challenger: "challenger",
} as const;

const MODEL = "mid";

// ------------------------------------------------------------------- prompts --

const JSON_ONLY = "Return JSON only, with no prose around it.";

function listPrompt(expert: Expert): string {
  return [
    "You are the Lead Explainer in a teaching session. Before you say anything, you decide what",
    "you are going to claim.",
    "",
    framing(expert),
    "",
    corpusBlock(expert),
    "",
    glossaryBlock(expert),
    "",
    "# Output contract",
    JSON_ONLY,
    `{"assertions":[{"id":"A1","kind":"grounded","statement":"...","sources":["P-..."]}]}`,
    "`grounded` is a claim about the world: it MUST cite the corpus passages it follows from.",
    "`scaffold` is an analogy, a framing or a worked example: it MAY be ungrounded and MUST cite",
    "nothing. Nothing is delivered until this list has been checked.",
  ].join("\n");
}

function verifyPrompt(expert: Expert): string {
  return [
    "You are an independent verifier. You did not write the claims below and you have no stake in",
    "them. For each one, decide whether it actually follows from the passages it cites.",
    "",
    "You are the half that a mechanical check cannot do: the kernel has already confirmed that",
    "every cited passage EXISTS. Your question is whether the passage SUPPORTS the claim.",
    "Say no when the claim overstates, when it adds something the passage does not say, or when",
    "the citation is decorative.",
    "",
    corpusBlock(expert),
    "",
    "# Output contract",
    JSON_ONLY,
    `{"verdicts":[{"id":"A1","ok":true,"reason":""}]}`,
    "One verdict per claim, using the claim's id. `reason` is required when `ok` is false.",
  ].join("\n");
}

function probePrompt(expert: Expert, list: AssertionList): string {
  return [
    "You write short comprehension probes for a lesson. You are NOT the explainer, and you will",
    "not deliver the lesson: your questions are placed into it by someone else.",
    "",
    "A probe is one sentence asking the learner to say something back in their own words. It is",
    "not a quiz item, it is not scored, and it must be answerable in a sentence. Write one per",
    "claim that a learner could plausibly have mis-followed.",
    "",
    "# The claims being taught",
    JSON.stringify(list),
    "",
    "# Output contract",
    JSON_ONLY,
    `{"probes":[{"id":"Q1","afterAssertion":"A1","prompt":"..."}]}`,
    "`afterAssertion` must be one of the claim ids above, so each probe lands next to what it is about.",
  ].join("\n");
}

function narrationPrompt(expert: Expert, list: AssertionList, probes: readonly Probe[]): string {
  return [
    "You are the Lead Explainer. The claims below have been verified, so teach them now.",
    "",
    framing(expert),
    "",
    glossaryBlock(expert),
    "",
    BLACKBOARD_CONTRACT,
    "",
    "# Verified claims — teach these, in this order",
    JSON.stringify(list),
    "",
    "# Probes to place as you go",
    JSON.stringify(probes),
    "Interleave `say` and `event` so the board fills in as you speak, and place each probe after",
    "the claim it is about using {\"probe\":\"<id>\"}. Do not invent probes: the ids above are the",
    "only ones that exist.",
    "",
    "# Output contract",
    JSON_ONLY,
    `{"steps":[{"say":"..."},{"event":{"kind":"text","id":"...","body":"..."}},{"probe":"Q1"}]}`,
    "Do not include an `at` field — position on the timeline is assigned for you.",
    "You may use `rich` only when nothing else in the vocabulary can express the idea.",
  ].join("\n");
}

function challengePrompt(expert: Expert, list: AssertionList): string {
  return [
    "You are the Challenger, not a second explainer. One specific wrong idea has just been",
    "detected, and your only job is to put it on the board and knock it down. Do not carry the",
    "lesson and do not re-teach the whole topic.",
    "",
    framing(expert),
    "",
    misconceptionBlock(expert),
    "",
    "# The claims the learner was taught",
    JSON.stringify(list),
    "",
    "# Output contract",
    JSON_ONLY,
    `{"steps":[{"say":"..."},{"event":{"kind":"text","id":"...","body":"..."}}]}`,
    "Name the wrong model as the learner holds it, then refute it. Do not use `probe` steps.",
  ].join("\n");
}

// --------------------------------------------------------------- the session --

export interface ApparatusInput {
  expert: Expert;
  check: UnderstandingCheck;
  /** Answers to the probes, in the order the probes were authored. */
  probeAnswers: readonly string[];
  terminalAnswer: string;
  sessionId?: string;
  store?: SessionStore;
}

export interface ApparatusResult {
  list: AssertionList;
  structural: ListVerdict;
  semantic: SemanticVerdict[];
  probes: Probe[];
  outcomes: ProbeOutcome[];
  challenge: { fired: boolean; triggers: string[] };
  verdict: CheckVerdict | null;
  log: SessionLog;
  surface: Surface;
  usage: LedgerRow;
  saved: boolean;
  /** Which stage stopped the session, when it stopped before teaching. */
  stoppedBefore: "semantic" | null;
  /** What ran, in order. The ablation experiment will diff these. */
  phases: string[];
}

/**
 * The apparatus (ADR 0003, 0005, 0009, 0013).
 *
 * Order is the whole design, so it is worth reading as a sequence:
 *
 *   1. the explainer states its claims            (no narration yet)
 *   2. the kernel checks every citation resolves  (free, deterministic)
 *   3. an INDEPENDENT actor checks claims against passages (the part the kernel cannot do)
 *   4. probes are authored by someone other than the explainer
 *   5. only now is anything said, and the probes are placed inside it
 *   6. the terminal check — a hand-authored asset, objectively graded
 *   7. probe outcomes are read by a separate actor
 *   8. the Challenger fires on a failed probe OR a failed check, and only then
 *   9. a retry re-realises the SAME claims with different words
 *
 * Step 9 is why step 1 exists: "explain it differently" is cheap because only the
 * realisation changes, not what is being taught.
 */
export async function runApparatusSession(
  provider: ModelProvider,
  input: ApparatusInput,
): Promise<ApparatusResult> {
  const meter = new SpendMeter(provider);
  const { expert, check } = input;
  const phases: string[] = [];

  // 1 — the claims.
  const listTurn = await meter.complete({
    actor: ACTOR.explainer,
    model: MODEL,
    system: listPrompt(expert),
    input: "State the claims you intend to teach.",
  });
  phases.push("assertion-list");
  const list = parseAssertionList(listTurn.text, expert.domain.id);

  // 2 — the kernel's structural check.
  const structural = verifyAssertionList(list, expert.domain.corpus);
  phases.push("structural-verify");
  if (!structural.ok) {
    const detail = structural.verdicts
      .filter((v) => !v.ok)
      .map((v) => `${v.id} (${v.reason})`)
      .join("; ");
    throw new Error(`assertion list failed structural verification, so nothing was said: ${detail}`);
  }

  // 3 — the independent semantic check.
  const semanticTurn = await meter.complete({
    actor: ACTOR.semanticVerifier,
    model: MODEL,
    system: verifyPrompt(expert),
    input: JSON.stringify({ assertions: list.assertions }),
  });
  phases.push("semantic-verify");
  const semantic = parseSemanticVerdicts(semanticTurn.text);

  const unsupported = semantic.filter((v) => !v.ok);
  if (unsupported.length > 0) {
    // ADR 0005: an unverified claim is not delivered. Note this stops the session
    // rather than warning: "teach it but mention it might be wrong" is how a
    // learner ends up unable to tell which parts to trust.
    phases.push("stopped-before-teaching");
    return {
      list,
      structural,
      semantic,
      probes: [],
      outcomes: [],
      challenge: { fired: false, triggers: [] },
      verdict: null,
      log: emptyLog(input.sessionId ?? `apparatus-${expert.domain.id}`),
      surface: render([]),
      usage: meter.total(),
      saved: false,
      stoppedBefore: "semantic",
      phases,
    };
  }

  // 4 — probes, authored by someone who is not the explainer.
  const probeTurn = await meter.complete({
    actor: ACTOR.probeAuthor,
    model: MODEL,
    system: probePrompt(expert, list),
    input: "Write the probes.",
  });
  phases.push("probe-author");
  const probes = parseProbes(probeTurn.text);

  // 5 — the narration, with the probes placed inside it.
  const narrationTurn = await meter.complete({
    actor: ACTOR.explainer,
    model: MODEL,
    system: narrationPrompt(expert, list, probes),
    input: "Teach the verified claims.",
  });
  phases.push("narration");
  const narration = parseExplanation(narrationTurn.text);
  const spoken = speakProbes(narration.steps, probes);

  const sessionId = input.sessionId ?? `apparatus-${expert.domain.id}`;
  let log = applySteps(emptyLog(sessionId), spoken, "lead-explainer");

  // 6 — the terminal check.
  const verdict = gradeObjectively(check, input.terminalAnswer);
  phases.push("terminal-check");

  // 7 — probe outcomes.
  const outcomes: ProbeOutcome[] = [];
  for (const [index, probe] of probes.entries()) {
    const answer = input.probeAnswers[index];
    if (answer === undefined) continue;
    const outcomeTurn = await meter.complete({
      actor: ACTOR.probeEvaluator,
      model: MODEL,
      system: [
        "You read one learner answer to one comprehension probe. You are not the explainer.",
        "",
        "Decide only two things: does this answer suggest a misunderstanding, and if so, which",
        "catalogue entry does it match? A vague or wrong-but-unlisted answer is still a concern",
        "with `misconceptionId: null` — do not force a match, because the Challenger will refute",
        "whatever you name, and refuting something the learner never believed makes them doubt",
        "what they had right.",
        "",
        misconceptionBlock(expert),
        "",
        "# Output contract",
        JSON_ONLY,
        `{"concern":true,"reason":"...","misconceptionId":"M-..."}`,
      ].join("\n"),
      input: JSON.stringify({ probe: probe.prompt, answer }),
    });
    outcomes.push(parseProbeOutcome(outcomeTurn.text, probe.id));
  }
  phases.push("probe-evaluation");

  // 8 — the Challenger, on exactly two triggers.
  const triggers: string[] = [];
  const concerned = outcomes.filter((o) => o.concern);
  if (concerned.length > 0) triggers.push(`probe:${concerned.map((o) => o.probeId).join(",")}`);
  if (verdict.verdict === "fail") triggers.push(`check:${check.id}`);

  if (triggers.length > 0) {
    const target =
      concerned.find((o) => o.misconceptionId !== null)?.misconceptionId ??
      verdict.diagnosis?.misconceptionId ??
      null;

    const challengeTurn = await meter.complete({
      actor: ACTOR.challenger,
      model: MODEL,
      system: challengePrompt(expert, list),
      input: JSON.stringify({ triggers, targetMisconception: target }),
    });
    phases.push("challenger");
    const challenge = parseExplanation(challengeTurn.text);
    log = applySteps(log, speakProbes(challenge.steps, []), "challenger");

    // 9 — a retry realises the same claims with different words.
    const retryTurn = await meter.complete({
      actor: ACTOR.explainer,
      model: MODEL,
      system: narrationPrompt(expert, list, []),
      input: "Teach the same claims again, differently. Change how you say it, not what you say.",
    });
    phases.push("re-teach");
    log = applySteps(log, speakProbes(parseExplanation(retryTurn.text).steps, []), "lead-explainer");
  }

  const surface = render(log.events);

  let saved = false;
  if (input.store !== undefined) {
    input.store.save(log);
    saved = input.store.has(sessionId);
  }

  return {
    list,
    structural,
    semantic,
    probes,
    outcomes,
    challenge: { fired: triggers.length > 0, triggers },
    verdict,
    log,
    surface,
    usage: meter.total(),
    saved,
    stoppedBefore: null,
    phases,
  };
}

/**
 * Turn probe steps into spoken narration.
 *
 * The probe's TEXT was written earlier by a different actor, so this is where the
 * explainer ends up asking a question it did not compose. A probe step naming an
 * id that was never authored is refused — otherwise a narration turn could invent
 * its own questions and quietly take the authorship back.
 */
function speakProbes(
  steps: readonly ExplanationStep[],
  probes: readonly Probe[],
): ExplanationStep[] {
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  return steps.map((step) => {
    if (step.probe === undefined) return step;
    const probe = byId.get(step.probe);
    if (probe === undefined) {
      throw new Error(`narration placed a probe that was never authored: ${JSON.stringify(step.probe)}`);
    }
    return { say: probe.prompt };
  });
}
