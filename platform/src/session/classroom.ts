import type { Persona, Style } from "../experts/types.ts";
import type { LedgerRow } from "../providers/meter.ts";
import { SpendMeter } from "../providers/meter.ts";
import type { ModelProvider } from "../providers/types.ts";

/**
 * The direct classroom (ADR 0011): a conversation, not a lesson that was verified first.
 *
 * What is deliberately absent: a corpus, an Assertion List, an independent verifier, a graded
 * check. This mode answers from the model's own knowledge, and the platform's job here is to
 * teach well and to SAY that nothing was verified — never to let the grounded session's
 * vocabulary describe it. The teaching discipline that survives is prompt-borne: one knowledge
 * point per reply, say-it-back before moving on, explain differently rather than repeating.
 */

/** Actor ids, one line each in the ledger — the same Positions as the grounded session. */
export const CLASSROOM_ACTOR = {
  explainer: "lead-explainer",
  challenger: "challenger",
} as const;

export type ClassroomActor = (typeof CLASSROOM_ACTOR)[keyof typeof CLASSROOM_ACTOR];

const MODEL = "mid";
const DELIVERY_LANGUAGE = "zh";

/**
 * The one line the explainer may end a reply with to summon the Challenger.
 *
 * A reserved marker, not a sentence: the server strips it before the learner sees anything, so
 * the summon travels through the same text as the delivery — no second channel, no classifier
 * call. Only the LAST non-empty line counts; a reply that merely mentions the marker does not
 * summon anyone.
 */
export const SUMMON_CHALLENGER = "[召唤质疑者]";

const label = (actor: ClassroomActor): string =>
  actor === CLASSROOM_ACTOR.challenger ? "质疑者" : "主讲";

/** One line of the conversation: the learner's words, or one of the two voices'. */
export interface ClassroomMessage {
  role: "learner" | "teacher";
  actor?: ClassroomActor;
  text: string;
}

export interface ClassroomTurn {
  actor: ClassroomActor;
  text: string;
}

export interface ClassroomSetup {
  persona: Persona;
  style: Style;
  /** The voice the Challenger speaks in — its own Persona (ADR 0009's split, same here). */
  challenger: Persona;
  topic: string;
}

/**
 * The conversation as the model sees it.
 *
 * The provider interface is one system prompt and one user message, so the transcript is
 * serialized into the message. The prompts say so, so the format is a contract and not a
 * surprise: every line is `学习者：…`, `主讲：…` or `质疑者：…`, and `last` is what the callee
 * is being asked to respond to (a stage direction may sit in parentheses there).
 */
function transcript(history: readonly ClassroomMessage[], last: string): string {
  const lines = history.map((message) =>
    message.role === "learner" ? `学习者：${message.text}` : `${label(message.actor as ClassroomActor)}：${message.text}`,
  );
  return [...lines, last].join("\n\n");
}

export function explainerPrompt(setup: ClassroomSetup): string {
  return [
    "You are the teacher in a one-on-one classroom. The learner has asked to be taught the",
    "subject below. You have no fixed material: you teach from what you know, and you say",
    "plainly when you are not sure instead of guessing.",
    "",
    "# The subject",
    setup.topic,
    "",
    "# Who is speaking",
    `name: ${setup.persona.name}`,
    `stance: ${setup.persona.stance}`,
    `register: ${setup.persona.register}`,
    "",
    "# How you build an explanation",
    `analogyDensity: ${setup.style.analogyDensity}`,
    `order: ${setup.style.order}`,
    `abstraction: ${setup.style.abstraction}`,
    `exampleType: ${setup.style.exampleType}`,
    "",
    "# How you teach — the classroom discipline",
    "- Break the subject into knowledge points yourself. Teach ONE point per reply.",
    "- Keep every reply short: a few sentences, the length of a spoken turn.",
    "- End most replies by asking the learner to say the point back in their own words.",
    "- Do not move on while their answer shows they have not got it. Explain that point",
    "  DIFFERENTLY — a new analogy or a different entry point — never the same words again.",
    "- Correct a wrong idea plainly, without belittling the person holding it.",
    `- If their answer shows a wrong idea that deserves a proper challenge, end your reply`,
    `  with a line that is exactly ${SUMMON_CHALLENGER} — and only then.`,
    "",
    `# Delivery language: ${DELIVERY_LANGUAGE}`,
    "",
    "# The transcript",
    "The conversation so far follows; its last line is the learner's new message. Reply to it",
    "as your next spoken turn: your own words only, with no label and no replay of the",
    "transcript.",
  ].join("\n");
}

export function challengerPrompt(setup: ClassroomSetup): string {
  return [
    "You are the Challenger in a one-on-one classroom — not a second teacher. The learner has",
    "just shown a wrong idea while being taught the subject below. Your whole job: put that",
    "wrong idea into words the way the learner holds it, then knock it down.",
    "",
    "# The subject",
    setup.topic,
    "",
    "# Who is speaking",
    `name: ${setup.challenger.name}`,
    `stance: ${setup.challenger.stance}`,
    `register: ${setup.challenger.register}`,
    "",
    "# How you challenge",
    "- Two or three sentences. Name the wrong model as they hold it; do not soften it into a",
    "  strawman, because refuting a position they never held makes them doubt what was right.",
    "- Refute it with something concrete. Do not carry the lesson afterwards.",
    "- Do not repeat the teacher's explanation: attack the wrong idea, not the learner.",
    "",
    `# Delivery language: ${DELIVERY_LANGUAGE}`,
    "",
    "# The transcript",
    "It follows, and it ends with a stage direction in parentheses — that line is for you, not",
    "speech. Reply as the Challenger's next spoken turn: your own words only, no label.",
  ].join("\n");
}

/** Remove the summon marker when — and only when — it is the last thing the reply says. */
export function stripSummon(reply: string): { text: string; summon: boolean } {
  const lines = reply.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (line === "") continue;
    if (line === SUMMON_CHALLENGER) {
      return { text: lines.slice(0, index).join("\n").trimEnd(), summon: true };
    }
    // The last non-empty line is something else; the marker is not a summon here.
    break;
  }
  return { text: reply.trim(), summon: false };
}

export interface ClassroomTurnInput {
  provider: ModelProvider;
  setup: ClassroomSetup;
  history: readonly ClassroomMessage[];
  /** What the learner just said. The first turn's message is the request to be taught. */
  message: string;
}

export interface ClassroomTurnResult {
  /** In order: the explainer's reply, and the challenger's when one was summoned. */
  turns: ClassroomTurn[];
  usage: LedgerRow;
}

/**
 * One learner message, one turn.
 *
 * Rendered complete rather than streamed: the reply's last line decides whether the Challenger
 * speaks, so streaming characters would race a marker the learner must never see (ADR 0011).
 */
export async function runClassroomTurn(input: ClassroomTurnInput): Promise<ClassroomTurnResult> {
  const meter = new SpendMeter(input.provider);

  const explainer = await meter.complete({
    actor: CLASSROOM_ACTOR.explainer,
    model: MODEL,
    system: explainerPrompt(input.setup),
    input: transcript(input.history, `学习者：${input.message}`),
  });

  const { text, summon } = stripSummon(explainer.text);
  const turns: ClassroomTurn[] = [{ actor: CLASSROOM_ACTOR.explainer, text }];

  if (summon) {
    const challenge = await meter.complete({
      actor: CLASSROOM_ACTOR.challenger,
      model: MODEL,
      system: challengerPrompt(input.setup),
      input: transcript(
        [
          ...input.history,
          { role: "learner", text: input.message },
          { role: "teacher", actor: CLASSROOM_ACTOR.explainer, text },
        ],
        "（请以质疑者的身份回应上一条主讲发言：点出并驳倒学习者的错误直觉。）",
      ),
    });
    turns.push({ actor: CLASSROOM_ACTOR.challenger, text: challenge.text.trim() });
  }

  return { turns, usage: meter.total() };
}
