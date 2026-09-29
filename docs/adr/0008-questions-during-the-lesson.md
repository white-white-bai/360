# A question asked during the lesson is answered from the corpus, and nothing measured changes

## The gap

ADR 0002 restricts only how a session **starts** — the Catalogue — and says explicitly that *"inside a session the learner may ask whatever they like."* ADR 0005 promises a real-time, interruptible lesson. The product was described, from the start, as something that explains after the learner raises a doubt.

None of that was built. The only input the machinery accepts while teaching is an **answer** to a question the platform asked: `POST /answer` exists for exactly that, and a learner's own question has nowhere to go.

This record closes the gap in the smallest shape that does not tear anything already decided: a question is taken at a pause the lesson already has, answered on the rails the lesson already uses, and kept away from everything the experiment measures.

## Where a question is taken

At a **step boundary of a teaching turn** — the narration, the challenger, the re-teaching. That is the pause probes already stop at, and for the same reason: an answer to a question about the sentence that was just said must not arrive after the lesson has moved on. The learner types whenever; the session stops at the next step that lands.

- **Not while the platform is waiting for the learner's answer.** A probe or a check pause is where the learner is being measured; a question typed then waits for the next teaching boundary.
- **Nothing survives the end of the lesson.** A question is taken at a teaching boundary or not at all: once the session closes — its checks passed, or the learner stopped — a queued question is dropped and the page is told, rather than answered after class.
- **One pending question at a time.** The next can be asked after the current one is answered. A question nobody asks costs nothing, and the lesson can never be held hostage by an input.

## The answer is a small teaching turn on the same rails

An answer is not a chat reply, and it adds no actor. The **Lead Explainer** — the persona already on stage — answers, through the same two-phase discipline as the lesson (ADR 0004, ADR 0005):

1. **Claims first.** The explainer states what it intends to assert, or declares explicitly that it cannot ground an answer in the Domain corpus. A question mark does not move the knowledge boundary.
2. **The kernel's structural check** runs — free, deterministic, always on.
3. **The independent verifier** checks that the cited passages support the claims. Same actor, same independence rule: the explainer does not verify its own answer.
4. **Only verified claims are narrated.** The answer streams onto the board — narration and events, one timeline, the same closed event vocabulary — and it may draw. No new Position, no new event kind.

What an answer can never do: add claims to the lesson's Assertion List, place probes, summon the Challenger, or move, re-word or grade the check. A detour enriches the session it happened in; it never becomes part of what is measured.

## The refusal is the honest endpoint, and the lesson survives it

An answer that cannot be grounded is not delivered. The learner gets **"I do not know"** — a first-class output (ADR 0004), not a failure — and the lesson continues.

The refusal's wording is composed by the kernel, not the model. A model-written refusal can hedge, apologise, and let a claim back in through the side door — and then the one output that must stay trustworthy and testable is the one nothing tests.

This deliberately differs from the lesson list, where an unverified claim **stops** the session. The difference is what a refusal replaces. For the lesson, stopping is the only way to guarantee the learner does not sit through material the platform cannot stand behind. For a question, refusal *is* the delivery — nothing unverified reaches the learner either way — and out-of-Domain curiosity is a normal event. A design that lets one unanswerable question destroy a verified lesson punishes the learner for asking.

A reply the machinery could not use is not a refusal: it is retried once, counted like every other retry, and if it still fails the aside ends in the same refusal line. The count stays visible in the ledger.

## The streamed-turn guarantee keeps its strength

ADR 0005's rule — the board the learner watched is the board the finished turn describes — must survive an interjection, and it does, at two strengths:

- **Nothing interjected:** the comparison is unchanged, bit for bit.
- **Something interjected:** content and order must match once the interjection's own recorded ranges are removed from what was watched. Positions are excluded, because an interjection necessarily moves them, and both sides allocate positions from the same clock.

This does not weaken the check where it does work: a scanner that drops, duplicates, invents or reorders a step still fails loudly. What is given up is position equality, which can differ only because of the interjection it is accommodating — and the range that is removed is recorded by the runner as the interjection happens, not guessed after the fact.

## The record

The learner's question goes into the session log verbatim, in its own section beside their probe answers and under the same lifecycle — the record is sensitive because it holds what the learner does not know (ADR 0002), and a question they asked is exactly that. The answer's narration and events are board content like any other, on the shared timeline.

A question the Domain could not answer is not a failed session; it is evidence about the Domain. Refused questions are the inverse of unlisted concerns: the misconception queue says where learners go wrong, the question queue says what they wanted that this Domain does not cover. (Turning that evidence into queue mechanics for the Owner is not in this cut; recording it is.)

## Considered options

- **A chat sidebar.** Rejected. It puts the answer outside the board, outside the timeline and outside the event stream — two ways to teach in one product, where the ungated one is also the easiest one to reach.
- **Answering without the corpus gate, trusting the model's fluency.** Rejected: it dismantles ADR 0004's guardrail inside the lesson, at the moment the learner is paying most attention.
- **Deferring questions to the end of the lesson.** Rejected for the reason probes were placed inline: an answer to a question about sentence 2, given after sentence 8, is about a lesson that no longer exists.
- **Stopping the session on an ungroundable question.** Rejected: it converts curiosity into punishment.
- **Folding an answer's claims into the lesson's Assertion List.** Rejected: it makes the lesson's content a function of what the learner happened to ask, and then the experiment compares conditions that are no longer the same lesson.

## Consequences

- **`runTurn` gains an interjection point** at each step boundary: the caller may hand back a log the interjection advanced, and the end-of-turn verification accommodates it at the two strengths above.
- **The blackboard page is wired in this cut**: an input that is open while teaching, a server endpoint that queues a question, and a refusal for a question no lesson is in a position to take. Learner mode on the recorded demo keeps the bar closed: a recording has no answer on file, and accepting a question there would fail the demonstration it exists to show. The terminal lesson keeps its linear flow for now — wiring it means deciding what a typed line means while the narration is scrolling (an answer, or a question), and that decision is not made here. Both faces can share one callback, so the terminal follows without redesign.
- **The session log gains `questions`**, defaulting to empty when a record written before this is loaded.
- **Every answered question costs calls** — claims, verification, narration, plus retries — and is metered in the ledger like everything else.
- **The acceptance experiment is untouched.** Its trials have simulated learners who ask nothing; a question cannot change what is being compared, and there is nothing to ablate — the machinery is a learner's move, not an apparatus piece.
