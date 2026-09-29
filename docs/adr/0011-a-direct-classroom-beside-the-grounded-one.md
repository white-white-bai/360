# A direct classroom exists beside the grounded one, and it says so

## What the owner decided, and what it costs

The owner's call: **enter the classroom directly and talk to the model.** No material built first, no Domain matched or drafted; the learner's message goes straight into the model's context, and two prompt-defined voices — the Lead Explainer and the Challenger — do the teaching, breaking the subject into knowledge points and taking them one at a time.

That is the thing this record's predecessors exist to prevent, so it is worth naming plainly:

- ADR 0002: *"Free-text entry is not a v1 entry point."*
- ADR 0004: *"A prompt cannot enforce a boundary, and a fluent wrong explanation is exactly the failure a learner cannot detect."*

The trade is accepted with the eyes open. A learner who wants to understand something today, on any subject, gets a teacher now instead of waiting for curated material; in exchange, nothing in this mode is traceable, verified, or gated — it answers from the model's own knowledge. The grounded session (corpus, Assertion List, independent verifier, checks, the signature gate) stays exactly where it is. This is a second mode, not a replacement, and the record's job is to keep the two from impersonating each other.

## The rule that makes coexistence safe

- **The mode is visible for the whole session.** The header says which classroom you are in, and the direct mode carries its one-line warning: 直接课堂：回答由模型现场给出，**未经过语料校验**.
- **The vocabulary stays clean.** A direct reply is not a Grounded Assertion and not a Scaffold; it is an unverified answer, and nothing in the UI or the record calls it anything else. No Understanding Check is graded here — a prompt can ask the learner to say a point back, and that question stays ungraded, exactly like a Probe.
- **The record's lifecycle is shared, the promises are not.** The transcript is sensitive the way everything the learner says is (ADR 0002), but a direct session never feeds the ablation experiment, which measures the grounded apparatus.

## The two voices, by prompt

Both prompts are the teaching design; there is no kernel behind them. What the prompts must carry, and what a fixture can pin:

- **Lead Explainer** — persona and style still apply (the axes are the axes). The classroom discipline: split the subject into knowledge points yourself; teach ONE point per reply; keep replies short; end most replies by asking the learner to say the point back in their own words; do not move on while they have not got it, and explain that point *differently* rather than repeating it; say plainly when unsure. If a wrong idea deserves a proper challenge, the reply ends with a reserved line — `[召唤质疑者]` — and only then.
- **Challenger** — the narrow job ADR 0003 gave it: put the wrong idea into words as the learner holds it, then knock it down; two or three sentences; never carry the lesson. Its own Persona applies.

The marker is stripped before the learner ever sees the reply, so the summon travels in the same text as the delivery — no second channel, no classifier call. A reply is rendered when it is complete: streaming characters would race the marker, and that race gets its own decision or it does not happen.

## Considered options

- **Replace the grounded mode.** Rejected: the corpus, the verifier and the acceptance experiment are the product's thesis; trading the only mechanism that makes teaching trustworthy for the one that makes it fast would leave nothing to be right about.
- **Ground each reply as it streams.** Rejected: that is the apparatus again, at the apparatus's cost, minus the curated corpus — verification with nothing to verify against.
- **Summon the Challenger on every turn, or on every learner answer.** Rejected: the ambient multi-agent noise ADR 0003 refused; a Challenger that always speaks is a second explainer wearing a costume.
- **A button that summons the Challenger.** Not in this cut. The marker is the cheaper protocol and it is model-steered; if the marker misfires in practice, the button is where this goes.

## Consequences

- The direct classroom is a module with two doors: `npm run classroom -- "<subject>"` in the terminal, and the board's entry, which carries the mode choice and the chat surface (`/classroom` + `POST /say`). The panel keeps its grounded door.
- One reply costs one call, plus one more when the Challenger is summoned; the ledger records both voices as their own actors.
- What must never happen without its own decision: letting a direct session grade, gate, sign, or claim grounding — or letting the grounded session's vocabulary describe it.
