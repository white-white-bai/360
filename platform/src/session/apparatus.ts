import { parseAssertionList } from "../assertions/parse.ts";
import type { AssertionList } from "../assertions/types.ts";
import type { CheckVerdict, UnderstandingCheck } from "../checks/types.ts";
import { gradeObjectively } from "../checks/grade.ts";
import type { Expert } from "../experts/types.ts";
import { verifyAssertionList } from "../grounding/verify.ts";
import type { ListVerdict } from "../grounding/verify.ts";
import type { SessionLog } from "../events/log.ts";
import { appendAnswer, appendQuestion, emptyLog, nextAt } from "../events/log.ts";
import type { LedgerRow } from "../providers/meter.ts";
import { SpendMeter } from "../providers/meter.ts";
import { runTurn } from "./stream.ts";
import { applySteps } from "./turn.ts";
import type { ModelProvider } from "../providers/types.ts";
import { ModelReplyUnusable, ReplyBudget } from "./retry.ts";
import { ask } from "./ask.ts";
import type { Surface } from "../render/render.ts";
import { render } from "../render/render.ts";
import type { Probe, ProbeOutcome, SemanticVerdict } from "./contracts.ts";
import { parseAnswerPlan, parseProbeOutcome, parseProbes, parseSemanticVerdicts } from "./contracts.ts";
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
  const ids = probes.map((probe) => probe.id);
  const placement =
    probes.length > 0
      ? [
          "# Probes to place as you go",
          JSON.stringify(probes),
          "Interleave `say` and `event` so the board fills in as you speak, and place each probe after",
          'the claim it is about using {"probe":"<id>"}.',
          `The ids ${ids.map((id) => `\`${id}\``).join(", ")} are the only ones that exist. A probe step naming`,
          "anything else is refused: inventing your own question would take the authorship of the questions",
          "back from whoever wrote them, which is the thing this split exists to prevent.",
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
    // The example is built from the ids that ACTUALLY exist, and shows no probe form at all
    // when there are none. It used to hard-code "Q1" while every other placeholder on the
    // line was "..." — and a live model copied the literal, placing a probe that had never
    // been authored. The fixture cannot show you that, because its probes happen to be
    // named Q1 and Q2; a real model does it on the first run.
    `{"steps":[{"say":"..."},{"event":{"kind":"text","id":"...","body":"..."}}${
      ids.length > 0 ? `,{"probe":"${ids[0] as string}"}` : ""
    }]}`,
    ...(ids.length === 0
      ? ["This lesson has no probes, so every step is either `say` or `event` — do not add a `probe` step."]
      : []),
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

function answerListPrompt(expert: Expert, question: string): string {
  return [
    "You are the Lead Explainer in a teaching session. The learner has asked a question mid-lesson,",
    "and you are deciding what you can claim in answer, before anything is said.",
    "",
    framing(expert),
    "",
    corpusBlock(expert),
    "",
    glossaryBlock(expert),
    "",
    "# The learner's question",
    question,
    "",
    "# Output contract",
    JSON_ONLY,
    'Either the claims your answer needs: {"assertions":[{"id":"A1","kind":"grounded","statement":"...","sources":["P-..."]}]}',
    'or an explicit refusal: {"cannotAnswer":"what the corpus does not settle"}',
    "A question mark does not move the knowledge boundary: if the corpus does not support an answer,",
    "declare that it cannot be answered rather than guessing. `grounded` claims MUST cite the corpus",
    "passages they follow from; `scaffold` MAY be ungrounded and MUST cite nothing.",
  ].join("\n");
}

function answerNarrationPrompt(expert: Expert, question: string, list: AssertionList): string {
  return [
    "You are the Lead Explainer. The verified claims below answer a question the learner asked",
    "mid-lesson. Answer it directly, resting on nothing else.",
    "",
    framing(expert),
    "",
    glossaryBlock(expert),
    "",
    BLACKBOARD_CONTRACT,
    "",
    "# The learner's question",
    question,
    "",
    "# Verified claims — the answer rests on these",
    JSON.stringify(list),
    "",
    "# Output contract",
    JSON_ONLY,
    `{"steps":[{"say":"..."},{"event":{"kind":"text","id":"...","body":"..."}}]}`,
    "This is a detour inside a lesson, not a second lesson: answer the question and stop. Do not use",
    "`probe` steps — an aside measures nothing — and do not include an `at` field.",
    "You may use `rich` only when nothing else in the vocabulary can express the idea.",
  ].join("\n");
}

/**
 * What the learner hears when the Domain cannot answer, or when the answer's machinery broke
 * (ADR 0008).
 *
 * Composed by the kernel, not the model: a model-written refusal can hedge, apologise and let
 * a claim back in through the side door — and then the one output that must stay trustworthy
 * and testable is the one nothing tests.
 */
export const CANNOT_ANSWER = "我不知道。这个问题超出了这节课能讲的范围。";

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
  /**
   * The Expert playing the Challenger position, when it is a different voice from the lead
   * (ADR 0009).
   *
   * A Position is a part and an Expert is a voice. The two SHARE one Domain — the refutation
   * has to come from the same corpus and the same misconception catalogue the lesson was
   * taught from — and may differ in Persona. Defaults to the lead's expert, which is what
   * every session before this decision had.
   */
  challenger?: Expert;
  check: UnderstandingCheck;
  /**
   * Answers to the probes, in the order the probes were authored.
   *
   * Used unless `askProbe` is supplied. The array is what a scripted or simulated learner
   * provides; a callback is what a person at a keyboard provides. The session does not care
   * which it was given, and that is the point — the loop is the same loop either way, so a
   * demonstration and a real lesson cannot drift apart.
   */
  probeAnswers: readonly string[];
  terminalAnswer: string;
  /**
   * When present, the terminal answer is ASKED FOR rather than read from `terminalAnswer`.
   *
   * It is asked at the one place the answer belongs — after the narration and before
   * grading — because asking earlier would be asking about a lesson the learner has not
   * had yet.
   */
  askTerminal?: (check: UnderstandingCheck) => Promise<string>;
  /** When present, each probe answer is asked for rather than read from `probeAnswers`. */
  askProbe?: (probe: Probe, index: number) => Promise<string | undefined>;
  /**
   * When present, the retake answer is asked for rather than read from `retryAnswer`.
   *
   * Only called when a retake is actually going to happen. Asking a question that is not
   * needed would make the extra sitting look like part of the lesson.
   */
  askRetake?: (check: UnderstandingCheck) => Promise<string | undefined>;
  /**
   * When present, the session checks for a question from the learner at every pause (ADR 0008).
   *
   * Polled at each step boundary of a teaching turn; a question starts an aside — claims,
   * verification, narration — on the same rails as the lesson. A callback rather than a list
   * because a question arrives when a person thinks of it, which is not something a simulated
   * learner ever does: the experiment's conditions stay free of this by never supplying one.
   */
  takeQuestion?: () => string | undefined;
  /**
   * Called as each phase STARTS, before its work (ADR 0009's live surface).
   *
   * The preparation is several model calls long — claims, independent verification, probe
   * authoring — and nothing lands on the board during it. Without this report, a page with a
   * real provider looks broken for exactly as long as those calls take. The sequence is the
   * same one `phases` records.
   */
  onPhase?: (phase: string) => void;
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
   * Where retries are counted, when the caller wants the number.
   *
   * Omitted means one is created and the count is only reported on the result. Supplied
   * means the caller can read it even when the session throws — which is the case that
   * matters, because a trial that died is exactly the one whose retry count is interesting.
   */
  retryBudget?: ReplyBudget;
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
  /**
   * Extra calls spent on replies that could not be used, across the whole session.
   *
   * Reported rather than folded into `usage`, because it is a tax the model levies and not
   * work the design asked for — and a reader comparing two conditions needs to see it.
   */
  retries: number;
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
  /** Each phase as it began, in order. The ablation experiment diffs these; a live page reads them. */
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
  const challengerExpert = input.challenger ?? expert;
  const disabled = [...(input.disable ?? [])];
  const off = (feature: ApparatusFeature): boolean => disabled.includes(feature);
  const phases: string[] = [];
  // The retry budget is supplied by the caller when the caller needs to know how much a
  // trial spent on unusable replies — which the experiment does, because a design that
  // makes more calls is more exposed to this and that exposure belongs in its cost.
  const budget = input.retryBudget ?? new ReplyBudget();

  const sessionId = input.sessionId ?? `apparatus-${expert.domain.id}`;

  /** Record a phase and say it out loud, at the moment its work starts. */
  const note = (name: string): void => {
    phases.push(name);
    input.onPhase?.(name);
  };

  // 1 — the claims. Supplied rather than generated during the experiment, so that
  // both conditions teach the same content.
  let list = input.list;
  const listInjected = list !== undefined;
  if (list === undefined) {
    note("assertion-list");
    list = await ask(
      meter,
      {
        actor: ACTOR.explainer,
        model: MODEL,
        system: listPrompt(expert),
        input: "State the claims you intend to teach.",
      },
      (text) => parseAssertionList(text, expert.domain.id),
      budget,
    );
  }

  // 2 — the kernel's structural check. Always on: it can only abort, never teach.
  note("structural-verify");
  const structural = verifyAssertionList(list, expert.domain.corpus);
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
    note("semantic-verify");
    semantic = await ask(
      meter,
      {
        actor: ACTOR.semanticVerifier,
        model: MODEL,
        system: verifyPrompt(expert),
        input: JSON.stringify({ assertions: list.assertions }),
      },
      parseSemanticVerdicts,
      budget,
    );

    const unsupported = semantic.filter((verdict) => !verdict.ok);
    if (unsupported.length > 0) {
      // ADR 0005: an unverified claim is not delivered. Note this STOPS the session
      // rather than warning — "teach it but mention it might be wrong" leaves the
      // learner unable to tell which parts to trust.
      note("stopped-before-teaching");
      return {
        list,
        listInjected,
        structural,
        semantic,
        probes: [],
        outcomes: [],
        unlistedConcerns: [],
        retries: budget.retries,
        challenge: { fired: false, triggers: [] },
        verdict: null,
        verdictAfterRetry: null,
        log: emptyLog(sessionId, { domainId: expert.domain.id }),
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
    note("probe-author");
    probes = await ask(
      meter,
      {
        actor: ACTOR.probeAuthor,
        model: MODEL,
        system: probePrompt(expert, list),
        input: "Write the probes.",
      },
      parseProbes,
      budget,
    );
  }

  // 5 — the narration, with the probes placed inside it.
  //
  // Streamed, because this is where the board fills (ADR 0005). The probes are substituted
  // per step as it lands: doing it afterwards would put probe IDs on the board while the turn
  // was arriving.
  //
  // Answers are collected HERE, at the moment each question is placed, rather than in one pass
  // at the end. Asking somebody about a question they saw two minutes ago, after the lesson has
  // moved on, is not a probe — it is a quiz on recall of the lesson's shape. Anything that
  // answers the array form is unaffected: the array is still read at the end, and this only
  // changes where a CALLBACK is called.
  const asked = new Map<string, string>();
  const place = async (
    log: SessionLog,
    step: ExplanationStep,
    source: ExplanationStep,
  ): Promise<void> => {
    // The question lands first, then it is put. The other order asks about something that is
    // not on the screen yet.
    await input.onStep?.(log, step);

    if (source.probe === undefined || input.askProbe === undefined) return;
    const index = probes.findIndex((candidate) => candidate.id === source.probe);
    if (index === -1) return; // `speakOne` already refused an unknown id, so this cannot happen
    const answer = await input.askProbe(probes[index] as Probe, index);
    // Recorded even when skipped, so the pass below knows this probe has already been put and
    // does not put it twice.
    asked.set(source.probe, answer ?? "");
  };

  /**
   * Answer a question the learner asked mid-lesson (ADR 0008).
   *
   * Same rails as the lesson: the explainer states claims, the kernel checks the citations,
   * an INDEPENDENT actor checks that the passages support them, and only then is anything
   * narrated — onto the board, streamed. Every way of failing ends in the same kernel-written
   * refusal rather than stopping a lesson whose own claims are all verified: a refusal is a
   * delivery (ADR 0004), and one unanswerable question must not destroy a whole class.
   */
  const answerQuestion = async (starting: SessionLog, question: string): Promise<SessionLog> => {
    // Where the question sits on the timeline, captured BEFORE the answer so the record places
    // it where it was asked rather than where the answer happened to end.
    const askedAt = nextAt(starting);
    let current = starting;
    let outcome: "answered" | "refused" = "refused";

    try {
      const plan = await ask(
        meter,
        {
          actor: ACTOR.explainer,
          model: MODEL,
          system: answerListPrompt(expert, question),
          input: "Decide what you can claim in answer.",
        },
        (text) => parseAnswerPlan(text, expert.domain.id),
        budget,
      );

      if (plan.kind === "claims") {
        const structuralAnswer = verifyAssertionList(plan.list, expert.domain.corpus);
        if (structuralAnswer.ok) {
          const supported = await ask(
            meter,
            {
              actor: ACTOR.semanticVerifier,
              model: MODEL,
              system: verifyPrompt(expert),
              input: JSON.stringify({ assertions: plan.list.assertions }),
            },
            parseSemanticVerdicts,
            budget,
          );

          if (supported.every((verdict) => verdict.ok)) {
            const spoken = await runTurn(
              meter,
              {
                actor: ACTOR.explainer,
                model: MODEL,
                system: answerNarrationPrompt(expert, question, plan.list),
                input: "Answer the learner's question.",
              },
              starting,
              "lead-explainer",
              {
                // An aside may not place probes: nothing inside an answer is measured, and the
                // probe ids belong to the lesson's own flow.
                prepare: (step) => {
                  if (step.probe !== undefined) {
                    throw new Error("an aside tried to place a probe — answers do not measure anything");
                  }
                  return step;
                },
                onStep: input.onStep,
                retry: budget,
              },
            );
            current = spoken.log;
            outcome = "answered";
          }
        }
      }
    } catch (error) {
      // A reply the machinery could not use is not a refusal by the Domain, but it is still not
      // an answer — the learner gets the same honest line instead of a stalled lesson, and the
      // retry count in the ledger shows what it cost.
      if (!(error instanceof ModelReplyUnusable)) throw error;
    }

    if (outcome === "refused") {
      current = applySteps(current, [{ say: CANNOT_ANSWER }], "lead-explainer");
    }
    // The words go into the record beside the learner's probe answers, under the same lifecycle
    // (ADR 0002): what they asked is as sensitive as what they answered.
    return appendQuestion(current, { at: askedAt, text: question, outcome });
  };

  /** Polled at every pause of a teaching turn; a question, when there is one, is answered here. */
  const interjection = async (current: SessionLog): Promise<SessionLog | undefined> => {
    const question = input.takeQuestion?.();
    if (question === undefined) return undefined;
    const trimmed = question.trim();
    if (trimmed === "") return undefined;
    return answerQuestion(current, trimmed);
  };

  note("narration");
  const narration = await runTurn(
    meter,
    {
      actor: ACTOR.explainer,
      model: MODEL,
      system: narrationPrompt(expert, list, probes),
      input: "Teach the verified claims.",
    },
    emptyLog(sessionId, { domainId: expert.domain.id }),
    "lead-explainer",
    { prepare: (step) => speakOne(step, probes), onStep: place, retry: budget, interlude: interjection },
  );
  let log = narration.log;

  // 6 — the terminal check. The same hand-authored asset in every condition.
  note("terminal-check");
  const terminalAnswer =
    input.askTerminal === undefined ? input.terminalAnswer : await input.askTerminal(check);
  const verdict = gradeObjectively(check, terminalAnswer);

  // 7 — probe outcomes.
  const outcomes: ProbeOutcome[] = [];
  if (!off("probes")) {
    note("probe-evaluation");
    for (const [index, probe] of probes.entries()) {
      // Already put, at the point in the lesson where the question belongs. Only a probe the
      // narration never placed is asked here — and it is still asked, because a model that
      // forgot to place one must not cost the session its measurement.
      let answer: string | undefined;
      if (asked.has(probe.id)) {
        const gathered = asked.get(probe.id) as string;
        answer = gathered === "" ? undefined : gathered;
      } else if (input.askProbe === undefined) {
        answer = input.probeAnswers[index];
      } else {
        answer = await input.askProbe(probe, index);
      }
      if (answer === undefined) continue;
      outcomes.push(
        await ask(
          meter,
          {
            actor: ACTOR.probeEvaluator,
            model: MODEL,
            system: PROBE_EVALUATOR_SYSTEM(expert),
            input: JSON.stringify({ probe: probe.prompt, answer }),
          },
          (text) => parseProbeOutcome(text, probe.id),
          budget,
        ),
      );
      // The learner's own words go into the log, which ADR 0002 already treats as a
      // sensitive record. Keeping them anywhere else would give the most sensitive
      // half of that record a different lifecycle and a different deletion
      // guarantee.
      log = appendAnswer(log, { at: nextAt(log), probeId: probe.id, text: answer });
    }
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

    note("challenger");
    const challenge = await runTurn(
      meter,
      {
        actor: ACTOR.challenger,
        model: MODEL,
        system: challengePrompt(challengerExpert, list),
        input: JSON.stringify({ triggers, targetMisconception: target }),
      },
      log,
      "challenger",
      { onStep: input.onStep, retry: budget, interlude: interjection },
    );
    log = challenge.log;

    // 9 — a retry realises the same claims with different words.
    note("re-teach");
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
      { onStep: input.onStep, retry: budget, interlude: interjection },
    );
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
  if (verdict.verdict === "fail" && !off("challenger")) {
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
    const retakeAsset = input.retakeCheck ?? check;
    const retryAnswer =
      input.askRetake === undefined ? input.retryAnswer : await input.askRetake(retakeAsset);

    // A learner who stops is not carried by the retake, and a question nobody was asked
    // must not be graded.
    if (retryAnswer !== undefined) {
      note("retake");
      verdictAfterRetry = gradeObjectively(retakeAsset, retryAnswer);
    }
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
    retries: budget.retries,
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
