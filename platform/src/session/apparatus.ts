import { parseAssertionList } from "../assertions/parse.ts";
import type { AssertionList } from "../assertions/types.ts";
import type { CheckVerdict, UnderstandingCheck } from "../checks/types.ts";
import { gradeObjectively } from "../checks/grade.ts";
import type { Expert } from "../experts/types.ts";
import { verifyAssertionList } from "../grounding/verify.ts";
import type { ListVerdict } from "../grounding/verify.ts";
import type { SessionLog } from "../events/log.ts";
import { appendAnswer, emptyLog, nextAt } from "../events/log.ts";
import type { LedgerRow } from "../providers/meter.ts";
import { SpendMeter } from "../providers/meter.ts";
import { runTurn } from "./stream.ts";
import type { ModelProvider } from "../providers/types.ts";
import type { Surface } from "../render/render.ts";
import { render } from "../render/render.ts";
import type { Probe, ProbeOutcome, SemanticVerdict } from "./contracts.ts";
import { parseProbeOutcome, parseProbes, parseSemanticVerdicts } from "./contracts.ts";
import type { ExplanationStep } from "./explanation.ts";
import { BLACKBOARD_CONTRACT, corpusBlock, framing, glossaryBlock, misconceptionBlock } from "./prompt.ts";
import type { SessionStore } from "./store.ts";

/** Actor ids. One line each in the ledger, and one per ADR 0004's independence rule. */
export const ACTOR = {
  explainer: "lead-explainer",
  semanticVerifier: "grounding-verifier",
  probeAuthor: "probe-author",
  probeEvaluator: "probe-evaluator",
  challenger: "challenger",
} as const;

const MODEL = "mid";

/**
 * The pieces of the apparatus that can be switched off, one at a time.
 *
 * This exists because of ADR 0015: "any piece that shows no measurable difference
 * against the baseline should be deleted", which is only checkable if each piece
 * can be removed on its own. Switching all three off is the baseline of ADR 0001.
 *
 * Note what is NOT switchable. The structural verification of the assertion list
 * stays on in every condition: it is a guard, not a teaching device, and it can
 * only ever abort a session, never improve one — so ablating it would change the
 * experiment's safety without changing what is being measured.
 *
 * The retry is tied to `challenger` rather than exposed separately, because ADR
 * 0003 makes them one mechanism: a challenge is what triggers a re-explanation.
 * Ablating the retry alone would leave a Challenger that refutes and then stops.
 */
export type ApparatusFeature = "semanticVerify" | "probes" | "challenger";

export const ALL_FEATURES: readonly ApparatusFeature[] = ["semanticVerify", "probes", "challenger"];

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
  const placement =
    probes.length > 0
      ? [
          "# Probes to place as you go",
          JSON.stringify(probes),
          "Interleave `say` and `event` so the board fills in as you speak, and place each probe after",
          "the claim it is about using {\"probe\":\"<id>\"}. Do not invent probes: the ids above are the",
          "only ones that exist.",
        ]
      : [];
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
    ...(placement.length > 0 ? ["", ...placement] : []),
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

const PROBE_EVALUATOR_SYSTEM = (expert: Expert): string =>
  [
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
  ].join("\n");

// --------------------------------------------------------------- the session --

export interface UnlistedConcern {
  probeId: string;
  /** What the learner actually said. Their own words, so it is sensitive like the rest. */
  answer: string;
  /** The evaluator's account of what looked wrong, which is the raw material for an entry. */
  reason: string;
}

export interface ApparatusInput {
  expert: Expert;
  check: UnderstandingCheck;
  /** Answers to the probes, in the order the probes were authored. */
  probeAnswers: readonly string[];
  terminalAnswer: string;
  /**
   * The learner's answer if they are asked again after a retry.
   *
   * ADR 0002 makes "the checks have PASSED" the end condition, so a failed check
   * leads to the Challenger, a retry, and a second sitting. Leaving this undefined
   * models a learner who stops instead — which ends the session on the first
   * verdict, because there is nothing else to go on.
   */
  retryAnswer?: string;
  /**
   * The asset for the second sitting, when it should differ from the first.
   *
   * Supplying one is the difference between measuring understanding and measuring
   * recall of a question the learner has just been shown the answer to.
   */
  retakeCheck?: UnderstandingCheck;
  /**
   * Called after each step lands, so a live board can redraw.
   *
   * The session neither knows nor cares whether anyone is watching. This is how the
   * blackboard stays a pure function of the events while still being shown as they
   * arrive — the alternative would be a second, incremental renderer, and then two
   * boards to keep in agreement.
   */
  onStep?: (log: SessionLog, step: ExplanationStep) => void;
  sessionId?: string;
  store?: SessionStore;
  /**
   * A list to teach, instead of generating one.
   *
   * This is here for the ablation experiment (ADR 0001): the claims are the
   * stimulus, and if each condition generated its own the comparison would be
   * between two different lessons rather than between two ways of teaching one.
   */
  list?: AssertionList;
  /** Pieces to switch off. Ablating all of them is ADR 0001's baseline. */
  disable?: readonly ApparatusFeature[];
}

export interface ApparatusResult {
  list: AssertionList;
  /** True when the list was supplied rather than generated — a constant, not a variable. */
  listInjected: boolean;
  structural: ListVerdict;
  semantic: SemanticVerdict[];
  probes: Probe[];
  outcomes: ProbeOutcome[];
  /**
   * Concerns the catalogue does not recognise (ADR 0004).
   *
   * A probe reporting "something is wrong here and I cannot name it" is evidence the
   * Misconception catalogue is incomplete. Dropping it means every unanticipated wrong
   * idea is forgotten the moment the session ends, and the catalogue can only ever hold
   * what somebody thought of in advance — which is the opposite of what a catalogue of
   * misconceptions is for.
   *
   * Returned rather than written. A session does not get to edit the Domain it was
   * taught from; deciding that a candidate is worth an entry is the Domain owner's job,
   * and it has to be, because every entry must also be reachable from a check.
   */
  unlistedConcerns: UnlistedConcern[];
  challenge: { fired: boolean; triggers: string[] };
  /** The first sitting. */
  verdict: CheckVerdict | null;
  /**
   * The second sitting, when a failed check was retaken.
   *
   * This is the one that decides whether the session achieved anything, because
   * passing is the end condition. Reporting only the first would record a learner
   * who was re-taught and then succeeded as having failed.
   */
  verdictAfterRetry: CheckVerdict | null;
  log: SessionLog;
  surface: Surface;
  usage: LedgerRow;
  saved: boolean;
  /** Which stage stopped the session, when it stopped before teaching. */
  stoppedBefore: "semantic" | null;
  /** What ran, in order. The ablation experiment diffs these. */
  phases: string[];
  /** What was switched off, so a result can never be read without its condition. */
  disabled: ApparatusFeature[];
}

/**
 * The apparatus (ADR 0003, 0005, 0009, 0013, 0015).
 *
 * Order is the whole design, so it is worth reading as a sequence:
 *
 *   1. the explainer states its claims            (no narration yet)
 *   2. the kernel checks every citation resolves  (free, deterministic, always on)
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
  const disabled = [...(input.disable ?? [])];
  const off = (feature: ApparatusFeature): boolean => disabled.includes(feature);
  const phases: string[] = [];

  const sessionId = input.sessionId ?? `apparatus-${expert.domain.id}`;

  // 1 — the claims. Supplied rather than generated during the experiment, so that
  // both conditions teach the same content.
  let list = input.list;
  const listInjected = list !== undefined;
  if (list === undefined) {
    const listTurn = await meter.complete({
      actor: ACTOR.explainer,
      model: MODEL,
      system: listPrompt(expert),
      input: "State the claims you intend to teach.",
    });
    phases.push("assertion-list");
    list = parseAssertionList(listTurn.text, expert.domain.id);
  }

  // 2 — the kernel's structural check. Always on: it can only abort, never teach.
  const structural = verifyAssertionList(list, expert.domain.corpus);
  phases.push("structural-verify");
  if (!structural.ok) {
    const detail = structural.verdicts
      .filter((verdict) => !verdict.ok)
      .map((verdict) => `${verdict.id} (${verdict.reason})`)
      .join("; ");
    throw new Error(`assertion list failed structural verification, so nothing was said: ${detail}`);
  }

  // 3 — the independent semantic check.
  let semantic: SemanticVerdict[] = [];
  if (!off("semanticVerify")) {
    const semanticTurn = await meter.complete({
      actor: ACTOR.semanticVerifier,
      model: MODEL,
      system: verifyPrompt(expert),
      input: JSON.stringify({ assertions: list.assertions }),
    });
    phases.push("semantic-verify");
    semantic = parseSemanticVerdicts(semanticTurn.text);

    const unsupported = semantic.filter((verdict) => !verdict.ok);
    if (unsupported.length > 0) {
      // ADR 0005: an unverified claim is not delivered. Note this STOPS the session
      // rather than warning — "teach it but mention it might be wrong" leaves the
      // learner unable to tell which parts to trust.
      phases.push("stopped-before-teaching");
      return {
        list,
        listInjected,
        structural,
        semantic,
        probes: [],
        outcomes: [],
        unlistedConcerns: [],
        challenge: { fired: false, triggers: [] },
        verdict: null,
        verdictAfterRetry: null,
        log: emptyLog(sessionId),
        surface: render([]),
        usage: meter.total(),
        saved: false,
        stoppedBefore: "semantic",
        phases,
        disabled,
      };
    }
  }

  // 4 — probes, authored by someone who is not the explainer.
  let probes: Probe[] = [];
  if (!off("probes")) {
    const probeTurn = await meter.complete({
      actor: ACTOR.probeAuthor,
      model: MODEL,
      system: probePrompt(expert, list),
      input: "Write the probes.",
    });
    phases.push("probe-author");
    probes = parseProbes(probeTurn.text);
  }

  // 5 — the narration, with the probes placed inside it.
  //
  // Streamed, because this is where the board fills (ADR 0005). The probes are
  // substituted per step as it lands: doing it afterwards would put probe IDs on the
  // board while the turn was arriving.
  const narration = await runTurn(
    meter,
    {
      actor: ACTOR.explainer,
      model: MODEL,
      system: narrationPrompt(expert, list, probes),
      input: "Teach the verified claims.",
    },
    emptyLog(sessionId),
    "lead-explainer",
    { prepare: (step) => speakOne(step, probes), onStep: input.onStep },
  );
  phases.push("narration");
  let log = narration.log;

  // 6 — the terminal check. The same hand-authored asset in every condition.
  const verdict = gradeObjectively(check, input.terminalAnswer);
  phases.push("terminal-check");

  // 7 — probe outcomes.
  const outcomes: ProbeOutcome[] = [];
  if (!off("probes")) {
    for (const [index, probe] of probes.entries()) {
      const answer = input.probeAnswers[index];
      if (answer === undefined) continue;
      const outcomeTurn = await meter.complete({
        actor: ACTOR.probeEvaluator,
        model: MODEL,
        system: PROBE_EVALUATOR_SYSTEM(expert),
        input: JSON.stringify({ probe: probe.prompt, answer }),
      });
      outcomes.push(parseProbeOutcome(outcomeTurn.text, probe.id));
      // The learner's own words go into the log, which ADR 0002 already treats as a
      // sensitive record. Keeping them anywhere else would give the most sensitive
      // half of that record a different lifecycle and a different deletion
      // guarantee.
      log = appendAnswer(log, { at: nextAt(log), probeId: probe.id, text: answer });
    }
    phases.push("probe-evaluation");
  }

  // A concern with no matching entry is the catalogue saying it is short. The index
  // pairs the outcome with the answer it was graded from, in the authored order.
  const unlistedConcerns: UnlistedConcern[] = outcomes
    .map((outcome, index) => ({ outcome, index }))
    .filter(({ outcome }) => outcome.concern && outcome.misconceptionId === null)
    .map(({ outcome, index }) => ({
      probeId: outcome.probeId,
      answer: input.probeAnswers[index] ?? "",
      reason: outcome.reason,
    }));

  // 8 — the Challenger, on exactly two triggers.
  const triggers: string[] = [];
  const concerned = outcomes.filter((outcome) => outcome.concern);
  if (concerned.length > 0) triggers.push(`probe:${concerned.map((outcome) => outcome.probeId).join(",")}`);
  if (verdict.verdict === "fail") triggers.push(`check:${check.id}`);

  if (triggers.length > 0 && !off("challenger")) {
    const target =
      concerned.find((outcome) => outcome.misconceptionId !== null)?.misconceptionId ??
      verdict.diagnosis?.misconceptionId ??
      null;

    const challenge = await runTurn(
      meter,
      {
        actor: ACTOR.challenger,
        model: MODEL,
        system: challengePrompt(expert, list),
        input: JSON.stringify({ triggers, targetMisconception: target }),
      },
      log,
      "challenger",
      { onStep: input.onStep },
    );
    phases.push("challenger");
    log = challenge.log;

    // 9 — a retry realises the same claims with different words.
    const retry = await runTurn(
      meter,
      {
        actor: ACTOR.explainer,
        model: MODEL,
        system: narrationPrompt(expert, list, []),
        input: "Teach the same claims again, differently. Change how you say it, not what you say.",
      },
      log,
      "lead-explainer",
      { onStep: input.onStep },
    );
    phases.push("re-teach");
    log = retry.log;
  }

  // 10 — the second sitting.
  //
  // ADR 0002 makes "the checks have PASSED" the end condition, so a failed check
  // has to lead somewhere other than the exit. Without this the retry cannot change
  // the outcome at all, and the apparatus would be judged on its first attempt no
  // matter how well it corrects — which is a measurement bug, not a design choice.
  //
  // The second sitting uses a different asset when one is supplied (`retakeCheck`),
  // because re-asking a question the learner has just been shown the answer to
  // measures recall of that question. Falling back to the same check is a visible
  // degradation, not a default.
  let verdictAfterRetry: CheckVerdict | null = null;
  if (verdict.verdict === "fail" && input.retryAnswer !== undefined && !off("challenger")) {
    // Gated on the Challenger being on, because the second sitting belongs to the
    // remediation path. Ablating the Challenger ablates the retake too — a baseline
    // that asked the learner again WITHOUT re-teaching them would be measuring a
    // different intervention rather than a cheaper one.
    //
    // A different asset is used when one is supplied. Re-asking the SAME question
    // right after showing the learner how to answer it measures recall of that
    // question, and the number would flatter the apparatus for a reason that has
    // nothing to do with understanding: the retake must describe a situation the
    // retry did not.
    verdictAfterRetry = gradeObjectively(input.retakeCheck ?? check, input.retryAnswer);
    phases.push("retake");
  }

  const surface = render(log.events);

  let saved = false;
  if (input.store !== undefined) {
    input.store.save(log);
    saved = input.store.has(sessionId);
  }

  return {
    list,
    listInjected,
    structural,
    semantic,
    probes,
    outcomes,
    unlistedConcerns,
    challenge: { fired: triggers.length > 0 && !off("challenger"), triggers },
    verdict,
    verdictAfterRetry,
    log,
    surface,
    usage: meter.total(),
    saved,
    stoppedBefore: null,
    phases,
    disabled,
  };
}

/** The same substitution, for one step at a time — the shape a streamed turn needs. */
function speakOne(step: ExplanationStep, probes: readonly Probe[]): ExplanationStep {
  const spoken = speakProbes([step], probes);
  return spoken[0] as ExplanationStep;
}

/**
 * Turn probe steps into spoken narration.
 *
 * The probe's TEXT was written earlier by a different actor, so this is where the
 * explainer ends up asking a question it did not compose. A probe step naming an
 * id that was never authored is refused — otherwise a narration turn could invent
 * its own questions and quietly take the authorship back.
 */
function speakProbes(steps: readonly ExplanationStep[], probes: readonly Probe[]): ExplanationStep[] {
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
